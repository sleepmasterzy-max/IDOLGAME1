const MAX_SCORES = 100;
const STORE_NAME = "nuomi-nmixx-leaderboard";
const SCORES_KEY = "scores";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return respond(204, {});
  }

  try {
    const store = await openCloudStore();
    const currentScores = sanitizeScores((await store.get(SCORES_KEY, {
      type: "json",
      consistency: "strong"
    })) || []);

    if (event.httpMethod === "GET") {
      return respond(200, {
        cloud: true,
        required: true,
        storage: "netlify-blobs",
        scores: currentScores
      });
    }

    if (event.httpMethod !== "POST") {
      return respond(405, { error: "Method not allowed" });
    }

    const body = parseBody(event.body);
    const id = String(body.id || "").trim();
    const time = Number(body.time);

    if (!id) {
      return respond(400, { error: "Player ID is required" });
    }

    if (id.length > 18) {
      return respond(400, { error: "Player ID is too long" });
    }

    if (!Number.isFinite(time) || time < 0 || time > 60 * 60 * 1000) {
      return respond(400, { error: "Invalid completion time" });
    }

    const normalizedId = id.toLocaleLowerCase();
    const previous = currentScores.find((score) => score.id.toLocaleLowerCase() === normalizedId);

    if (previous && previous.time <= time) {
      return respond(200, {
        cloud: true,
        required: true,
        accepted: false,
        previousBest: previous.time,
        scores: currentScores
      });
    }

    const nextScores = sanitizeScores([
      ...currentScores.filter((score) => score.id.toLocaleLowerCase() !== normalizedId),
      {
        id,
        time,
        createdAt: new Date().toISOString()
      }
    ]);

    if (typeof store.setJSON === "function") {
      await store.setJSON(SCORES_KEY, nextScores);
    } else {
      await store.set(SCORES_KEY, JSON.stringify(nextScores));
    }

    return respond(200, {
      cloud: true,
      required: true,
      accepted: true,
      scores: nextScores
    });
  } catch (error) {
    return respond(500, {
      error: "Leaderboard unavailable",
      detail: error.message
    });
  }
};

async function openCloudStore() {
  const { getStore } = await import("@netlify/blobs");

  try {
    return getStore({
      name: STORE_NAME,
      consistency: "strong"
    });
  } catch (error) {
    return getStore(STORE_NAME);
  }
}

function parseBody(body) {
  try {
    return body ? JSON.parse(body) : {};
  } catch (error) {
    return {};
  }
}

function sanitizeScores(scores) {
  const byId = new Map();

  if (!Array.isArray(scores)) return [];

  scores.forEach((score) => {
    const id = String(score.id || "").trim().slice(0, 18);
    const time = Number(score.time);
    if (!id || !Number.isFinite(time) || time < 0) return;

    const normalizedId = id.toLocaleLowerCase();
    const existing = byId.get(normalizedId);

    if (!existing || time < existing.time) {
      byId.set(normalizedId, {
        id,
        time,
        createdAt: score.createdAt || new Date().toISOString()
      });
    }
  });

  return Array.from(byId.values()).sort((a, b) => a.time - b.time).slice(0, MAX_SCORES);
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: statusCode === 204 ? "" : JSON.stringify(body)
  };
}
