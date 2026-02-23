import express from "express";
import cors from "cors";
import webpush from "web-push";

const app = express();
app.use(express.json({ limit: "1mb" }));

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

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:info@uic-campana.com.ar";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("⚠️  Faltan VAPID keys. Setear VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.");
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
