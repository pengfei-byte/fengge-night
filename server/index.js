import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { characterPrompt, FENG, scenePrompt, sessionBriefing } from "./persona.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);
const BASE = process.env.POPVID_BASE_URL || "https://popvid.ai/api/public/v1";
const KEY = process.env.POPVID_API_KEY;
const SEED_IMAGE_URL = (process.env.SEED_IMAGE_URL || "").trim();
const VOICE_REF_URL = (process.env.VOICE_REF_URL || "").trim();
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_SESSIONS || 3);
const CONNECT_LIMIT = Number(process.env.CONNECT_LIMIT_PER_IP || 12);
const CONNECT_WINDOW_MS = 15 * 60 * 1000;
const HARD_CLOSE_MS = 300_000;

const sessions = new Map();
const connectHits = new Map();

if (!KEY) {
  console.warn("Missing POPVID_API_KEY — 峰哥连不上实时画面");
}

app.set("trust proxy", true);
app.use(cors({ origin: true }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function publicOrigin(req) {
  if (PUBLIC_BASE) return PUBLIC_BASE;
  const xfProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const xfHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = xfHost || req?.headers?.host || "";
  const proto = xfProto || (req?.protocol === "https" || req?.secure ? "https" : "http");
  if (!host || /localhost|127\.0\.0\.1/i.test(host)) return "";
  return `${proto}://${host}`;
}

function assetUrl(req, envUrl, pathname) {
  if (envUrl) return envUrl;
  const origin = publicOrigin(req);
  return origin ? `${origin}${pathname}` : "";
}

function clientIp(req) {
  return req.headers["cf-connecting-ip"] || req.ip || req.socket?.remoteAddress || "unknown";
}

function allowConnect(ip) {
  const now = Date.now();
  const recent = (connectHits.get(ip) || []).filter((t) => now - t < CONNECT_WINDOW_MS);
  if (recent.length >= CONNECT_LIMIT) return false;
  recent.push(now);
  connectHits.set(ip, recent);
  return true;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  };
}

function viewerError(raw, status) {
  const code = raw?.code || "upstream";
  const messages = {
    no_capacity: "他那边占线。过一会儿再叫。",
    budget_exhausted: "这把额度用完了。换一把钥匙或者等额度回来。",
    content_rejected: "这张形象图没过审。换一张不含敏感内容的 3:4 照片再试。",
    unauthorized: "钥匙不对，服务端拒绝了。",
    invalid_request: raw?.message || "请求没通过。检查形象图和音色地址。",
  };
  return {
    code,
    message: messages[code] || raw?.message || "视频暂时打不通。再试一次。",
    status,
  };
}

async function createRealtimeSession(req) {
  const seed = assetUrl(req, SEED_IMAGE_URL, FENG.portrait);
  const voice = assetUrl(req, VOICE_REF_URL, "/fengge-voice.m4a");
  const body = {
    model: "r2-realtime-v1",
    character: {
      name: FENG.name,
      prompt: characterPrompt(),
    },
    scene: { prompt: scenePrompt() },
    language: "zh",
    limits: { max_duration_ms: HARD_CLOSE_MS, max_turns: 40, turn_rate_per_min: 16 },
    credentials_ttl_ms: 600_000,
    metadata: { product: "fengge-night" },
  };
  if (seed) body.seed_image_url = seed;
  if (voice) body.character.voice_ref_url = voice;
  console.log("[feng] seed", seed || "(none)", "voice", voice || "(default)");

  const res = await fetch(`${BASE}/connections`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data, seed };
}

async function closeRemote(sessionId) {
  const row = sessions.get(sessionId);
  if (row?.timer) clearTimeout(row.timer);
  sessions.delete(sessionId);
  if (!KEY || !sessionId) return { ok: true, status: 200, data: { ok: true } };
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok || res.status === 404, status: res.status, data };
}

function trackSession({ sessionId, ip }) {
  const timer = setTimeout(() => {
    closeRemote(sessionId).catch(() => {});
  }, HARD_CLOSE_MS);
  sessions.set(sessionId, {
    ip,
    createdAt: Date.now(),
    lastLease: Date.now(),
    timer,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    product: "fengge-night",
    title: FENG.title,
    name: FENG.name,
    realtime: Boolean(KEY),
    sessions: sessions.size,
    portrait: FENG.portrait,
    briefing: sessionBriefing(),
    hard_close_ms: HARD_CLOSE_MS,
  });
});

app.post("/api/calls", async (req, res) => {
  const briefing = sessionBriefing();
  const payload = {
    character: FENG,
    briefing,
    hard_close_ms: HARD_CLOSE_MS,
  };

  if (!KEY) {
    return res.status(503).json({
      ...payload,
      error: { code: "misconfigured", message: "服务端还没配实时钥匙。" },
    });
  }

  if (sessions.size >= MAX_CONCURRENT) {
    return res.status(429).json({
      ...payload,
      error: { code: "busy", message: "这会儿人满了。过一会儿再叫。", retry_after_ms: 8000 },
    });
  }

  const ip = clientIp(req);
  if (!allowConnect(ip)) {
    return res.status(429).json({
      ...payload,
      error: { code: "rate_limited", message: "这个网络叫得太勤。过一分钟再来。", retry_after_ms: 60_000 },
    });
  }

  const seedPreview = assetUrl(req, SEED_IMAGE_URL, FENG.portrait);
  if (!seedPreview) {
    return res.status(503).json({
      ...payload,
      error: {
        code: "no_seed",
        message: "形象图必须是公网地址。本地请设置 PUBLIC_BASE_URL，或直接给 SEED_IMAGE_URL。",
      },
    });
  }

  let result;
  try {
    result = await createRealtimeSession(req);
    for (let attempt = 0; attempt < 3 && !result.ok && result.data?.error?.code === "no_capacity"; attempt += 1) {
      const wait = Number(result.data?.error?.retry_after_ms || 5000);
      await new Promise((resolve) => setTimeout(resolve, wait));
      result = await createRealtimeSession(req);
    }
  } catch (err) {
    console.error("[feng] fetch threw", err);
    return res.status(502).json({
      ...payload,
      error: { code: "upstream_unreachable", message: `线路暂时不通：${err.message}` },
    });
  }

  if (!result.ok) {
    const err = viewerError(result.data?.error, result.status);
    console.error("[feng] rejected", result.status, err.code, err.message);
    return res.status(result.status || 502).json({ ...payload, error: err });
  }

  const { session, credentials } = result.data || {};
  if (!session?.session_id || !credentials) {
    return res.status(502).json({
      ...payload,
      error: { code: "bad_payload", message: "会话没建起来。再试一次。" },
    });
  }

  trackSession({ sessionId: session.session_id, ip });
  res.status(201).json({
    ...payload,
    credentials,
    session: {
      session_id: session.session_id,
      reservation_expires_at_ms: session.reservation_expires_at_ms,
      media: session.media,
      hard_close_ms: HARD_CLOSE_MS,
    },
  });
});

app.post("/api/sessions/:id/heartbeat", (req, res) => {
  const row = sessions.get(req.params.id);
  if (!row) return res.status(404).json({ ok: false });
  row.lastLease = Date.now();
  res.json({ ok: true });
});

app.delete("/api/sessions/:id", async (req, res) => {
  const result = await closeRemote(req.params.id);
  res.status(result.ok ? 200 : result.status).json(result.data || { ok: true });
});

app.post("/api/sessions/:id/close", async (req, res) => {
  await closeRemote(req.params.id);
  res.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`亡命夜谈 http://0.0.0.0:${PORT}`);
  });

  setInterval(() => {
    const cutoff = Date.now() - 25_000;
    for (const [id, row] of sessions) {
      if (row.lastLease < cutoff || Date.now() - row.createdAt > HARD_CLOSE_MS + 5_000) {
        closeRemote(id).catch(() => {});
      }
    }
  }, 5_000);
}
