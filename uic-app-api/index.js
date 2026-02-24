import express from "express";
import cors from "cors";
import webpush from "web-push";
import { XMLParser } from "fast-xml-parser";

/**
 * UIC Campana API (Node/Express)
 * - Health check
 * - Proxy lectura de contenido (WordPress) para el frontend PWA
 * - (Opcional) Push Web con VAPID (si se configura)
 *
 * IMPORTANTE:
 * - La REST API de WordPress puede estar bloqueada por plugins de seguridad (ej: iThemes).
 * - Para no depender de acceso al admin, esta API soporta modo "rss" (por defecto),
 *   leyendo el feed público /feed/ (normalmente no está bloqueado).
 */

/* ----------------------------- Config ---------------------------------- */

const PORT = process.env.PORT || 10000;

// CORS: Render Static Site -> Web Service
// Podés dejar "*" para MVP, pero es mejor especificar el origen del frontend.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Modo WordPress: "rss" (default) o "rest"
const WP_MODE = (process.env.WP_MODE || "rss").toLowerCase();

// Base pública del sitio WP (RSS/HTML).
// Nota: si se usa un subdirectorio de idioma (ej: /ar), en algunos setups
// el endpoint /ar/feed/ puede devolver feed de *comentarios* y no de posts.
// Normalizamos para evitar ese caso y además permitimos override con WP_FEED_URL.
function normalizeWpSiteBase(raw) {
  const s = String(raw || "").trim();
  let out = s.replace(/\/+$/, ""); // quitar slashes finales
  out = out.replace(/\/(ar)$/, ""); // quitar /ar final si existe
  return out || "https://uic-campana.com.ar";
}

const WP_SITE_BASE = normalizeWpSiteBase(
  process.env.WP_SITE_BASE || "https://uic-campana.com.ar"
);

// Feed RSS público. Si no se setea, usamos /feed/ del WP_SITE_BASE normalizado.
const WP_FEED_URL = (process.env.WP_FEED_URL || `${WP_SITE_BASE}/feed/`)
  .trim()
  .replace(/\s+/g, "");

// Base para REST (si NO está bloqueada). Ej: https://site.com/wp-json/wp/v2
const WP_BASE = (process.env.WP_BASE || `${WP_SITE_BASE}/wp-json/wp/v2`).trim();

// Si la REST está protegida y vos TENÉS un "Application Password":
// WP_AUTH_B64 = base64("user:app_password")  (sin comillas)
// PERO: si NO tenés acceso al admin, NO uses REST. Quedate en RSS.
const WP_AUTH_B64 = (process.env.WP_AUTH_B64 || "").trim();

// Push (opcional)
const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim();

/* ----------------------------- App ------------------------------------- */

const app = express();
app.use(express.json());

// CORS
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / server-to-server
      if (ALLOWED_ORIGINS.includes("*")) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

/* ----------------------------- Push config ------------------------------ */

let PUSH_ENABLED = false;

try {
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    PUSH_ENABLED = true;
  } else {
    console.warn("ℹ️  Push no configurado (faltan VAPID keys).");
  }
} catch (e) {
  console.warn("⚠️  VAPID inválido, push deshabilitado:", e?.message || e);
  PUSH_ENABLED = false;
}

/* ----------------------------- Helpers ---------------------------------- */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // WordPress suele meter HTML dentro de CDATA.
  cdataPropName: "__cdata",
});

/** Decodifica algunas entidades HTML básicas */
function decodeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&#8217;", "’")
    .replaceAll("&#8211;", "–")
    .replaceAll("&#8212;", "—")
    .replaceAll("&#8220;", "“")
    .replaceAll("&#8221;", "”");
}

/** Normaliza categoría a slug */
function slugify(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 
 * Fetch JSON con headers opcionales (REST)
 */
async function fetchJson(url) {
  const headers = {};
  if (WP_AUTH_B64) headers["Authorization"] = `Basic ${WP_AUTH_B64}`;
  const r = await fetch(url, { headers });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    const body = ct.includes("application/json") ? await r.json().catch(() => null) : await r.text().catch(() => "");
    const msg = body?.message || body?.error || (typeof body === "string" ? body : "");
    throw new Error(`WP REST ${r.status}: ${msg || "error"}`);
  }
  return r.json();
}

/**
 * Fetch RSS y convierte a items comunes
 */
async function fetchRssItems(feedUrl) {
  const r = await fetch(feedUrl);
  if (!r.ok) throw new Error(`RSS ${r.status}: ${feedUrl}`);
  const xml = await r.text();

  const data = parser.parse(xml);
  const channel = data?.rss?.channel || data?.feed; // RSS2 vs Atom
  const items = channel?.item || channel?.entry || [];
  const arr = Array.isArray(items) ? items : [items];

  // Algunos feeds (por ej. "Comentarios en:") no contienen posts.
  // Si detectamos ese caso (o feed vacío), devolvemos [] para que el llamador
  // pueda aplicar fallback.
  const chTitle = String(channel?.title || "").toLowerCase();
  const looksLikeCommentsFeed = chTitle.includes("comentarios") || chTitle.includes("comments");
  if (looksLikeCommentsFeed || arr.length === 0) {
    return [];
  }

  // Normalizamos a "post"
  return arr
    .map((it) => {
      const title = decodeHtml(it?.title?.["__cdata"] || it?.title || "");
      const link = it?.link?.["#text"] || it?.link?.["@_href"] || it?.link || "";
      const guid = it?.guid?.["__cdata"] || it?.guid || link;
      const pubDate = it?.pubDate || it?.published || it?.updated || "";
      const rawCats = it?.category || [];
      const catsArr = Array.isArray(rawCats) ? rawCats : [rawCats];
      const categories = catsArr
        .map((c) => decodeHtml(c?.["__cdata"] || c?.["#text"] || c || ""))
        .filter(Boolean);

      // WordPress: content:encoded suele venir en "content:encoded"
      const content =
        decodeHtml(it?.["content:encoded"]?.["__cdata"] || it?.["content:encoded"] || it?.content?.["__cdata"] || it?.description?.["__cdata"] || it?.description || "");

      // Extrae primera imagen si existe
      let image = "";
      const m = content.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) image = m[1];

      return {
        id: guid,
        title,
        link,
        date: pubDate,
        categories,
        category_slugs: categories.map(slugify),
        excerpt: content.replace(/<[^>]+>/g, "").slice(0, 240).trim(),
        image,
      };
    })
    .filter((p) => p.title || p.link);
}

/* ----------------------------- Routes ---------------------------------- */

app.get("/", (req, res) => {
  res.type("text/plain").send(
    "UIC Campana API OK. Endpoints: /health, /wp/posts, /wp/categories, /vapid-public-key, /subscribe"
  );
});

app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * GET /wp/posts
 * Query:
 * - per_page (default 10)
 * - search
 * - category (slug)  -> beneficios | eventos | etc.
 */
app.get("/wp/posts", async (req, res) => {
  const perPage = Math.min(parseInt(req.query.per_page || "10", 10), 50);
  const search = (req.query.search || "").toString().trim().toLowerCase();
  const category = (req.query.category || "").toString().trim().toLowerCase();

  try {
    // ---- MODE REST (solo si NO está bloqueado) ----
    if (WP_MODE === "rest") {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage));
      if (search) params.set("search", search);

      // En REST, category es numérico; si nos pasan slug, intentamos resolverlo.
      if (category) {
        // Busca categorías por slug
        const cats = await fetchJson(`${WP_BASE}/categories?per_page=100`);
        const found = (cats || []).find((c) => c?.slug === category);
        if (found?.id) params.set("categories", String(found.id));
      }

      const posts = await fetchJson(`${WP_BASE}/posts?${params.toString()}`);
      const normalized = (posts || []).map((p) => ({
        id: p.id,
        title: decodeHtml(p?.title?.rendered || ""),
        link: p.link,
        date: p.date,
        categories: [], // se completa si hace falta
        excerpt: decodeHtml((p?.excerpt?.rendered || "").replace(/<[^>]+>/g, "")).slice(0, 240).trim(),
        image: p?.yoast_head_json?.og_image?.[0]?.url || "",
      }));
      return res.json({ mode: "rest", items: normalized });
    }

    // ---- MODE RSS (default) ----
    const base = WP_SITE_BASE;

    // Si hay categoría, intentamos feed de categoría (más eficiente)
    const feedUrl = category
      ? `${base}/category/${encodeURIComponent(category)}/feed/`
      : WP_FEED_URL;

    let items = await fetchRssItems(feedUrl);

    // Si WP no tiene /category/slug/feed/, cae a feed global y filtramos
    if (category && items.length === 0) {
      const all = await fetchRssItems(WP_FEED_URL);
      items = all.filter((p) => p.category_slugs.includes(category));
    }

    // Filtro búsqueda (cliente)
    if (search) {
      items = items.filter((p) => (p.title + " " + p.excerpt).toLowerCase().includes(search));
    }

    items = items.slice(0, perPage);

    res.json({ mode: "rss", feed: feedUrl, items });
  } catch (e) {
    res.status(502).json({
      error: "wp_fetch_failed",
      message: e?.message || String(e),
      hint:
        "Si WP REST está bloqueada (401 ithemes), usá WP_MODE=rss y WP_SITE_BASE. Probá el feed público /feed/ en el navegador.",
    });
  }
});

/**
 * GET /wp/categories
 * - RSS: calcula categorías a partir del feed
 * - REST: devuelve categorías del endpoint
 */
app.get("/wp/categories", async (req, res) => {
  try {
    if (WP_MODE === "rest") {
      const cats = await fetchJson(`${WP_BASE}/categories?per_page=100`);
      const normalized = (cats || []).map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
      return res.json({ mode: "rest", items: normalized });
    }

    const items = await fetchRssItems(WP_FEED_URL);
    const map = new Map();
    for (const p of items) {
      for (let i = 0; i < p.categories.length; i++) {
        const name = p.categories[i];
        const slug = p.category_slugs[i] || slugify(name);
        if (!slug) continue;
        if (!map.has(slug)) map.set(slug, { slug, name });
      }
    }
    res.json({ mode: "rss", items: Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    res.status(502).json({ error: "wp_categories_failed", message: e?.message || String(e) });
  }
});

/* ----------------------------- Push endpoints --------------------------- */

// clave pública para que el frontend arme subscription
app.get("/vapid-public-key", (req, res) => {
  if (!PUSH_ENABLED) return res.status(404).json({ ok: false, pushEnabled: false });
  res.json({ ok: true, pushEnabled: true, publicKey: VAPID_PUBLIC_KEY });
});

// suscripciones en memoria (MVP)
const subscriptions = new Set();

app.post("/subscribe", (req, res) => {
  if (!PUSH_ENABLED) return res.status(400).json({ ok: false, pushEnabled: false });
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ ok: false, error: "invalid_subscription" });
  subscriptions.add(JSON.stringify(sub));
  res.json({ ok: true, pushEnabled: true });
});

/* ----------------------------- Start ----------------------------------- */

app.listen(PORT, () => {
  console.log(`UIC API running on :${PORT}`);
  console.log(`WP_MODE=${WP_MODE} WP_SITE_BASE=${WP_SITE_BASE}`);
});
