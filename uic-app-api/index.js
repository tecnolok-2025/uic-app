import express from "express";
import cors from "cors";
import webpush from "web-push";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Página raíz (para que al abrir el dominio no parezca “roto”)
app.get("/", (_req, res) => {
  res
    .type("text")
    .send(
      "UIC Campana API OK. Endpoints: /health, /wp/posts, /wp/categories, /vapid-public-key, /subscribe"
    );
});

// --- WordPress proxy (evita problemas de CORS desde el frontend) ---
const WP_BASE =
  process.env.WP_BASE || "https://uic-campana.com.ar/wp-json/wp/v2";

// Optional: WP Basic Auth (recommended if your WP blocks public REST API).
// Set ONE of:
// - WP_AUTH_B64="base64(user:app_password)"
// - WP_USER + WP_APP_PASSWORD
function wpAuthHeader() {
  const b64 = (process.env.WP_AUTH_B64 || "").trim();
  if (b64) return `Basic ${b64}`;

  const user = (process.env.WP_USER || "").trim();
  const pass = (process.env.WP_APP_PASSWORD || "").trim();
  if (user && pass) {
    const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }
  return null;
}

function wpHeaders() {
  const h = { Accept: "application/json" };
  const auth = wpAuthHeader();
  if (auth) h.Authorization = auth;
  return h;
}

// Helpers: arma query string seguro
function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    usp.set(k, String(v));
  });
  const s = usp.toString();
  return s ? `?${s}` : "";
}

// Proxy: posts
app.get("/wp/posts", async (req, res) => {
  try {
    const { page = "1", per_page = "10", search = "", categories = "" } = req.query;

    const url =
      `${WP_BASE}/posts` +
      qs({
        _embed: "1",
        page,
        per_page,
        search,
        categories,
      });

    const r = await fetch(url, { headers: wpHeaders() });

    const text = await r.text();

    // Propaga status y headers útiles (paginación)
    res.status(r.status);
    ["x-wp-total", "x-wp-totalpages"].forEach((h) => {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    });

    // si WP devuelve JSON válido, lo pasamos tal cual
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(text);
  } catch (e) {
    console.error("WP proxy error:", e?.message || e);
    return res.status(500).json({ error: "wp_proxy_failed" });
  }
});

// Proxy: categorías (por si después se usa para 'beneficios', 'eventos', etc.)
app.get("/wp/categories", async (req, res) => {
  try {
    const { per_page = "100", search = "" } = req.query;

    const url =
      `${WP_BASE}/categories` +
      qs({
        per_page,
        search,
        hide_empty: "0",
      });

    const r = await fetch(url, { headers: wpHeaders() });
    const text = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(text);
  } catch (e) {
    console.error("WP categories proxy error:", e?.message || e);
    return res.status(500).json({ error: "wp_categories_proxy_failed" });
  }
});

// Diagnóstico rápido (útil para confirmar si WP responde o si pide auth)
app.get("/wp/ping", async (_req, res) => {
  try {
    const url = `${WP_BASE}/posts` + qs({ per_page: "1" });
    const r = await fetch(url, { headers: wpHeaders() });
    const text = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(text);
  } catch (e) {
    console.error("WP ping error:", e?.message || e);
    return res.status(500).json({ error: "wp_ping_failed" });
  }
});


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

const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
let VAPID_SUBJECT = (process.env.VAPID_SUBJECT || "mailto:info@uic-campana.com.ar").trim();

// web-push exige que el "subject" sea una URL (https://...) o un mailto:...
// Si el usuario cargó un email sin "mailto:", lo corregimos automáticamente.
if (VAPID_SUBJECT && !VAPID_SUBJECT.startsWith("mailto:") && VAPID_SUBJECT.includes("@") && !VAPID_SUBJECT.startsWith("http")) {
  VAPID_SUBJECT = `mailto:${VAPID_SUBJECT}`;
}

let PUSH_ENABLED = false;

try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    PUSH_ENABLED = true;
    console.log("WebPush enabled ✅");
  } else {
    console.warn("⚠️  Faltan VAPID keys. Setear VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.");
  }
} catch (e) {
  // No tiramos abajo el server por VAPID inválido: solo deshabilitamos push.
  console.warn("⚠️  VAPID inválido, push deshabilitado:", e?.message || e);
  PUSH_ENABLED = false;
}


// MVP storage in-memory (se pierde con sleep/restart en Render Free)
const subscriptions = new Map(); // endpoint -> { subscription, preferences }

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/vapid-public-key", (_req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(500).json({ error: "VAPID_PUBLIC_KEY missing" });
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/subscribe", (req, res) => {
  const { subscription, preferences } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: "Invalid subscription" });
  subscriptions.set(subscription.endpoint, { subscription, preferences: preferences || { categories: [] } });
  res.json({ ok: true });
});

app.post("/notify/new-posts", async (req, res) => {
  const token = req.headers["x-cron-token"];
  if (!token || token !== process.env.CRON_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  if (!PUSH_ENABLED) return res.status(503).json({ error: "PUSH_DISABLED", detail: "VAPID inválido o no configurado" });


  const { title, url, category } = req.body || {};
  const payload = JSON.stringify({
    title: title || "Nueva publicación",
    body: category ? `Nueva publicación en ${category}` : "Nueva publicación en UIC",
    url: url || "https://uic-campana.com.ar/",
    badgeCountDelta: 1
  });

  let ok = 0, fail = 0;

  for (const [endpoint, row] of subscriptions.entries()) {
    const prefs = row.preferences || { categories: [] };
    if (category && Array.isArray(prefs.categories) && prefs.categories.length > 0) {
      if (!prefs.categories.includes(category)) continue;
    }

    try {
      await webpush.sendNotification(row.subscription, payload);
      ok++;
    } catch (e) {
      fail++;
      if (e?.statusCode === 410 || e?.statusCode === 404) subscriptions.delete(endpoint);
    }
  }

  res.json({ ok: true, sent: ok, failed: fail, total: subscriptions.size });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`UIC API running on :${port}`));