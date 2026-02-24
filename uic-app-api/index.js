import express from "express";
import cors from "cors";
import webpush from "web-push";
import fs from "node:fs";
import path from "node:path";

const app = express();
app.use(express.json({ limit: "1mb" }));

// -----------------------------
// CORS
// -----------------------------
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    return cb(null, ALLOWED_ORIGINS.includes(origin));
  }
}));

// -----------------------------
// VAPID
// -----------------------------
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:info@uic-campana.com.ar";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("⚠️  Faltan VAPID keys. Setear VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.");
}

// -----------------------------
// Storage (persistente en archivo)
// -----------------------------
const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), "state.json");

function safeReadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function safeWriteState(obj) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    console.warn("⚠️  No se pudo escribir state.json:", e?.message || e);
  }
}

const state = safeReadState();
const subscriptions = new Map(); // endpoint -> { subscription, preferences }
if (Array.isArray(state.subscriptions)) {
  for (const item of state.subscriptions) {
    if (item?.subscription?.endpoint) {
      subscriptions.set(item.subscription.endpoint, { subscription: item.subscription, preferences: item.preferences || { categories: [] } });
    }
  }
}

function persistSubscriptions() {
  const arr = Array.from(subscriptions.values());
  safeWriteState({ ...state, subscriptions: arr, updated_at: new Date().toISOString() });
}

// -----------------------------
// Health / Status
// -----------------------------
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/status", (_req, res) => res.json({
  ok: true,
  vapid: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
  subscriptions: subscriptions.size,
  allowed_origins: ALLOWED_ORIGINS,
}));

app.get("/vapid-public-key", (_req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(500).json({ error: "VAPID_PUBLIC_KEY missing" });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// -----------------------------
// Push subscribe / notify
// -----------------------------
app.post("/subscribe", (req, res) => {
  const { subscription, preferences } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: "Invalid subscription" });

  subscriptions.set(subscription.endpoint, {
    subscription,
    preferences: preferences || { categories: [] }
  });
  persistSubscriptions();
  res.json({ ok: true, subscriptions: subscriptions.size });
});

// Manual test notify (para debug). Protegido opcionalmente por ADMIN_TOKEN.
app.post("/notify/test", async (req, res) => {
  const admin = process.env.ADMIN_TOKEN;
  if (admin && req.headers["x-admin-token"] !== admin) {
    return res.status(403).json({ error: "Forbidden (missing x-admin-token)" });
  }
  const payload = req.body?.payload || {
    title: "UIC Campana",
    body: "Notificación de prueba",
    data: { url: "/" }
  };
  const results = [];
  for (const [endpoint, item] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(item.subscription, JSON.stringify(payload));
      results.push({ endpoint, ok: true });
    } catch (e) {
      results.push({ endpoint, ok: false, error: e?.message || String(e) });
    }
  }
  res.json({ ok: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});

// Cron notify new posts (compatible con tu endpoint anterior)
app.post("/notify/new-posts", async (req, res) => {
  const token = req.headers["x-cron-token"];
  if (process.env.CRON_TOKEN && token !== process.env.CRON_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const payload = req.body?.payload || {
    title: "UIC Campana",
    body: "Hay nuevas publicaciones",
    data: { url: "/?tab=posts" }
  };

  const results = [];
  for (const [endpoint, item] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(item.subscription, JSON.stringify(payload));
      results.push({ endpoint, ok: true });
    } catch (e) {
      results.push({ endpoint, ok: false, error: e?.message || String(e) });
    }
  }
  res.json({ ok: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length });
});

// -----------------------------
// WordPress Proxy (evita CORS / bloqueos)
// -----------------------------
const DEFAULT_WP = process.env.WP_BASE || "https://uic-campana.com.ar/wp-json/wp/v2";

function buildWpUrl(kind, query) {
  const base = DEFAULT_WP.endsWith("/") ? DEFAULT_WP : DEFAULT_WP + "/";
  const u = new URL(kind, base);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

app.get("/wp/categories", async (req, res) => {
  try {
    const url = buildWpUrl("categories", req.query);
    const r = await fetch(url, { headers: { "User-Agent": "UIC-App-Proxy/1.0" } });
    const txt = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(txt);
  } catch (e) {
    res.status(502).json({ error: "WP proxy error", detail: e?.message || String(e) });
  }
});

app.get("/wp/posts", async (req, res) => {
  try {
    const url = buildWpUrl("posts", req.query);
    const r = await fetch(url, { headers: { "User-Agent": "UIC-App-Proxy/1.0" } });
    const txt = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(txt);
  } catch (e) {
    res.status(502).json({ error: "WP proxy error", detail: e?.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`uic-app-api listening on :${PORT}`));
