import express from "express";
import cors from "cors";
import webpush from "web-push";
import { XMLParser } from "fast-xml-parser";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

// En ESM no existe __dirname por defecto
const __dirname = path.dirname(new URL(import.meta.url).pathname);

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
// IMPORTANTE:
// - NO hardcodear claves.
// - En producción (Render) se deben cargar como Environment Variables.
// - A veces al copiar/pegar quedan comillas, espacios, saltos de línea o formato base64 (con + / =).
//   Normalizamos a Base64URL (sin '=') para evitar falsos inválidos.
function normalizeVapidKey(raw) {
  if (!raw) return "";
  let s = String(raw).trim();

  // Si alguien pegó JSON completo por error (ej: {"publicKey":"...","privateKey":"..."})
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const obj = JSON.parse(s);
      if (typeof obj?.publicKey === "string") s = obj.publicKey;
      else if (typeof obj?.privateKey === "string") s = obj.privateKey;
    } catch (_) {
      // ignorar
    }
    s = String(s).trim();
  }

  // Quitar comillas envolventes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }

  // Quitar espacios/saltos de línea internos
  s = s.replace(/\s+/g, "");

  // Normalizar base64 -> base64url
  s = s.replace(/\+/g, "-").replace(/\//g, "_");

  // Quitar padding '=' (web-push exige sin '=')
  s = s.replace(/=+$/g, "");

  return s;
}

function isBase64UrlNoPad(s) {
  return typeof s === "string" && s.length > 0 && /^[A-Za-z0-9\-_]+$/.test(s);
}

const VAPID_PUBLIC_KEY = normalizeVapidKey(process.env.VAPID_PUBLIC_KEY);
const VAPID_PRIVATE_KEY = normalizeVapidKey(process.env.VAPID_PRIVATE_KEY);
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim();

/* ----------------------------- Agenda ---------------------------------- */

// IMPORTANTE (Render Free): el filesystem puede ser efímero entre redeploys.
// Para este MVP persistimos en un JSON local. Si más adelante querés DB real, se migra.
const EVENTS_FILE = (process.env.EVENTS_FILE || path.join(__dirname, "data", "events.json")).trim();
const EVENT_ADMIN_TOKEN = (process.env.EVENT_ADMIN_TOKEN || "").trim();

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readEventsStore() {
  try {
    const raw = fs.readFileSync(EVENTS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.events)) {
      return {
        events: parsed.events,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch (_) {}
  return { events: [], updatedAt: new Date().toISOString() };
}

function writeEventsStore(store) {
  ensureDir(path.dirname(EVENTS_FILE));
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

let EVENTS_STORE = readEventsStore();

/* ---------------------- Comunicación al socio (COMMS) ------------------- */

// Almacena comunicaciones del admin hacia usuarios.
// MVP: JSON local (Render Free puede resetear al dormir/redeploy).
const COMMS_FILE = (process.env.COMMS_FILE || path.join(__dirname, "data", "comms.json")).trim();

function readCommsStore() {
  try {
    const raw = fs.readFileSync(COMMS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.items)) {
      return {
        items: parsed.items,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch (_) {}
  return { items: [], updatedAt: new Date().toISOString() };
}

function writeCommsStore(store) {
  ensureDir(path.dirname(COMMS_FILE));
  fs.writeFileSync(COMMS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

let COMMS_STORE = readCommsStore();


/* ---------------------- Persistencia (Opción B: DB externa) ---------------------- */

// En Render Free, la memoria y el filesystem local pueden resetearse cuando la instancia duerme o se redeploya.
// Si configurás DATABASE_URL, se usa una DB externa (Postgres) para persistir agenda y comunicaciones.
const DATABASE_URL = String(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL || "").trim();
const DB_SSL = String(process.env.DATABASE_SSL || "true").trim().toLowerCase() !== "false";

// Retención (ajustable por env). Por defecto: agenda ~ 400 días; comunicaciones: 50 últimas.
const EVENTS_KEEP_DAYS = Math.max(parseInt(process.env.EVENTS_KEEP_DAYS || "400", 10) || 400, 30);
const COMMS_KEEP = Math.min(Math.max(parseInt(process.env.COMMS_KEEP || "50", 10) || 50, 1), 200);

let dbReady = false;
let pool = null;

async function initDb() {
  if (!DATABASE_URL) return;
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DB_SSL ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    await pool.query("SELECT 1");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS uic_events (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        highlight BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS uic_events_date_idx ON uic_events(date)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS uic_comms (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS uic_comms_created_idx ON uic_comms(created_at)`);

    dbReady = true;
    console.log("✅ DB externa habilitada (DATABASE_URL). Persistencia OK.");
  } catch (e) {
    dbReady = false;
    console.log("⚠️ DB externa no disponible, usando JSON local:", e?.message || e);
  }
}

async function pruneDb() {
  if (!dbReady) return;
  try {
    // Agenda: mantener últimos EVENTS_KEEP_DAYS
    await pool.query(`DELETE FROM uic_events WHERE date < (CURRENT_DATE - ($1 || ' days')::interval)`, [String(EVENTS_KEEP_DAYS)]);

    // Comms: mantener últimas COMMS_KEEP
    await pool.query(
      `DELETE FROM uic_comms WHERE id IN (
         SELECT id FROM uic_comms
         ORDER BY created_at DESC
         OFFSET $1
       )`,
      [COMMS_KEEP]
    );
  } catch (_) {}
}


function touchCommsStore() {
  COMMS_STORE.updatedAt = new Date().toISOString();
  writeCommsStore(COMMS_STORE);
}

function touchEventsStore() {
  EVENTS_STORE.updatedAt = new Date().toISOString();
  writeEventsStore(EVENTS_STORE);
}

function requireAdmin(req, res, next) {
  if (!EVENT_ADMIN_TOKEN) {
    return res.status(403).json({ error: "EVENT_ADMIN_TOKEN no configurado en el servidor." });
  }
  const t = (req.header("x-admin-token") || "").trim();
  if (t !== EVENT_ADMIN_TOKEN) return res.status(401).json({ error: "No autorizado." });
  next();
}

function isoDateOnly(s) {
  if (typeof s !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function inRange(d, from, to) {
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

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

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn("ℹ️  Push no configurado (faltan VAPID keys).");
} else if (!isBase64UrlNoPad(VAPID_PUBLIC_KEY) || !isBase64UrlNoPad(VAPID_PRIVATE_KEY)) {
  // Ayuda de diagnóstico SIN exponer secretos
  console.warn(
    "⚠️  VAPID inválido, push deshabilitado: las keys no son Base64URL (sin '=').",
    `public.len=${VAPID_PUBLIC_KEY?.length || 0} private.len=${VAPID_PRIVATE_KEY?.length || 0}`
  );
  PUSH_ENABLED = false;
} else {
  // Log de diagnóstico (solo public key parcial)
  console.log(
    `🔐 VAPID cargado: public.len=${VAPID_PUBLIC_KEY.length} public.preview=${VAPID_PUBLIC_KEY.slice(0, 10)}...`
  );
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    PUSH_ENABLED = true;
  } catch (e) {
    console.warn("⚠️  VAPID inválido, push deshabilitado:", e?.message || e);
    PUSH_ENABLED = false;
  }
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

/* ----------------------------- Eventos --------------------------------- */

app.get("/events/meta", async (req, res) => {
  try {
    if (dbReady) {
      const r = await pool.query("SELECT COUNT(*)::int AS count, MAX(updated_at) AS updated_at FROM uic_events");
      const count = r.rows?.[0]?.count || 0;
      const updatedAt = r.rows?.[0]?.updated_at ? new Date(r.rows[0].updated_at).toISOString() : "";
      return res.json({ updatedAt, count });
    }
  } catch (e) {
    console.log("⚠️ DB events/meta error, fallback JSON:", e?.message || e);
  }
  return res.json({ updatedAt: EVENTS_STORE.updatedAt, count: EVENTS_STORE.events.length });
});

app.get("/events", async (req, res) => {
  const from = isoDateOnly((req.query.from || "").toString().trim());
  const to = isoDateOnly((req.query.to || "").toString().trim());

  try {
    if (dbReady) {
      let q = "SELECT id, to_char(date,'YYYY-MM-DD') AS date, title, COALESCE(description,'') AS description, highlight, created_at, updated_at FROM uic_events";
      const params = [];
      if (from || to) {
        q += " WHERE 1=1";
        if (from) { params.push(from); q += ` AND date >= $${params.length}`; }
        if (to) { params.push(to); q += ` AND date <= $${params.length}`; }
      }
      q += " ORDER BY date ASC";
      const r = await pool.query(q, params);

      const items = (r.rows || []).map((x) => ({
        id: x.id,
        date: x.date,
        title: x.title,
        description: x.description || "",
        highlight: Boolean(x.highlight),
        createdAt: x.created_at ? new Date(x.created_at).toISOString() : "",
        updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : "",
      }));

      const meta = await pool.query("SELECT MAX(updated_at) AS updated_at FROM uic_events");
      const updatedAt = meta.rows?.[0]?.updated_at ? new Date(meta.rows[0].updated_at).toISOString() : "";

      return res.json({ updatedAt, items });
    }
  } catch (e) {
    console.log("⚠️ DB events/list error, fallback JSON:", e?.message || e);
  }

  const items = (EVENTS_STORE.events || [])
    .filter((ev) => inRange(ev.date, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return res.json({ updatedAt: EVENTS_STORE.updatedAt, items });
});

app.post("/events", requireAdmin, async (req, res) => {
  const date = isoDateOnly(req.body?.date);
  const title = (req.body?.title || "").toString().trim();
  const description = (req.body?.description || "").toString().trim();
  const highlight = Boolean(req.body?.highlight);

  if (!date) return res.status(400).json({ error: "date inválida (formato: YYYY-MM-DD)" });
  if (!title) return res.status(400).json({ error: "title requerido" });

  const now = new Date().toISOString();
  const id = `ev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  try {
    if (dbReady) {
      await pool.query(
        "INSERT INTO uic_events(id, date, title, description, highlight, created_at, updated_at) VALUES($1,$2,$3,$4,$5,NOW(),NOW())",
        [id, date, title, description, highlight]
      );
      await pruneDb();
      return res.status(201).json({ ok: true, item: { id, date, title, description, highlight, createdAt: now, updatedAt: now }, updatedAt: now });
    }
  } catch (e) {
    console.log("⚠️ DB events/create error, fallback JSON:", e?.message || e);
  }

  const ev = { id, date, title, description, highlight, createdAt: now, updatedAt: now };
  EVENTS_STORE.events.unshift(ev);
  touchEventsStore();
  return res.status(201).json({ ok: true, item: ev, updatedAt: EVENTS_STORE.updatedAt });
});

app.put("/events/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();

  const date = req.body?.date ? isoDateOnly(req.body.date) : null;
  const title = req.body?.title !== undefined ? (req.body.title || "").toString().trim() : null;
  const description = req.body?.description !== undefined ? (req.body.description || "").toString().trim() : null;
  const highlight = req.body?.highlight !== undefined ? Boolean(req.body.highlight) : null;

  try {
    if (dbReady) {
      // Trae actual para completar campos omitidos
      const cur = await pool.query("SELECT id, to_char(date,'YYYY-MM-DD') AS date, title, COALESCE(description,'') AS description, highlight FROM uic_events WHERE id=$1", [id]);
      if (!cur.rows?.length) return res.status(404).json({ error: "Evento no encontrado" });
      const base = cur.rows[0];

      const newDate = date || base.date;
      const newTitle = title !== null ? title : base.title;
      const newDesc = description !== null ? description : (base.description || "");
      const newHighlight = highlight !== null ? highlight : Boolean(base.highlight);

      if (!newDate) return res.status(400).json({ error: "date inválida (formato: YYYY-MM-DD)" });
      if (!newTitle) return res.status(400).json({ error: "title requerido" });

      const now = new Date().toISOString();
      await pool.query(
        "UPDATE uic_events SET date=$2, title=$3, description=$4, highlight=$5, updated_at=NOW() WHERE id=$1",
        [id, newDate, newTitle, newDesc, newHighlight]
      );
      await pruneDb();
      return res.json({ ok: true, item: { id, date: newDate, title: newTitle, description: newDesc, highlight: newHighlight, updatedAt: now }, updatedAt: now });
    }
  } catch (e) {
    console.log("⚠️ DB events/update error, fallback JSON:", e?.message || e);
  }

  const idx = (EVENTS_STORE.events || []).findIndex((x) => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Evento no encontrado" });

  const newDate = date || EVENTS_STORE.events[idx].date;
  const newTitle = title !== null ? title : EVENTS_STORE.events[idx].title;
  const newDesc = description !== null ? description : EVENTS_STORE.events[idx].description;
  const newHighlight = highlight !== null ? highlight : EVENTS_STORE.events[idx].highlight;

  if (!newDate) return res.status(400).json({ error: "date inválida (formato: YYYY-MM-DD)" });
  if (!newTitle) return res.status(400).json({ error: "title requerido" });

  EVENTS_STORE.events[idx] = { ...EVENTS_STORE.events[idx], date: newDate, title: newTitle, description: newDesc, highlight: newHighlight, updatedAt: new Date().toISOString() };
  touchEventsStore();
  return res.json({ ok: true, item: EVENTS_STORE.events[idx], updatedAt: EVENTS_STORE.updatedAt });
});

app.delete("/events/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();

  try {
    if (dbReady) {
      const r = await pool.query("DELETE FROM uic_events WHERE id=$1", [id]);
      if (!r.rowCount) return res.status(404).json({ error: "Evento no encontrado" });
      const now = new Date().toISOString();
      await pruneDb();
      return res.json({ ok: true, updatedAt: now });
    }
  } catch (e) {
    console.log("⚠️ DB events/delete error, fallback JSON:", e?.message || e);
  }

  const before = EVENTS_STORE.events.length;
  EVENTS_STORE.events = (EVENTS_STORE.events || []).filter((x) => x.id !== id);
  if (EVENTS_STORE.events.length === before) return res.status(404).json({ error: "Evento no encontrado" });
  touchEventsStore();
  return res.json({ ok: true, updatedAt: EVENTS_STORE.updatedAt });
});

/* -------------------- Comunicación al socio (COMMS) --------------------- */

app.get("/comms/meta", async (req, res) => {
  try {
    if (dbReady) {
      const r = await pool.query("SELECT COUNT(*)::int AS count, MAX(created_at) AS updated_at FROM uic_comms");
      const count = r.rows?.[0]?.count || 0;
      const updatedAt = r.rows?.[0]?.updated_at ? new Date(r.rows[0].updated_at).toISOString() : "";
      return res.json({ updatedAt, count });
    }
  } catch (e) {
    console.log("⚠️ DB comms/meta error, fallback JSON:", e?.message || e);
  }
  return res.json({ updatedAt: COMMS_STORE.updatedAt, count: COMMS_STORE.items.length });
});

app.get("/comms", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 200);

  try {
    if (dbReady) {
      const r = await pool.query(
        "SELECT id, title, message, created_at FROM uic_comms ORDER BY created_at DESC LIMIT $1",
        [limit]
      );

      const items = (r.rows || []).map((x) => ({
        id: x.id,
        title: x.title,
        message: x.message,
        createdAt: x.created_at ? new Date(x.created_at).toISOString() : "",
      }));

      const meta = await pool.query("SELECT MAX(created_at) AS updated_at FROM uic_comms");
      const updatedAt = meta.rows?.[0]?.updated_at ? new Date(meta.rows[0].updated_at).toISOString() : "";

      return res.json({ updatedAt, items });
    }
  } catch (e) {
    console.log("⚠️ DB comms/list error, fallback JSON:", e?.message || e);
  }

  const items = (COMMS_STORE.items || []).slice(0, limit);
  return res.json({ updatedAt: COMMS_STORE.updatedAt, items });
});

app.post("/comms", requireAdmin, async (req, res) => {
  const title = (req.body?.title || "").toString().trim();
  const message = (req.body?.message || "").toString().trim();

  if (!title) return res.status(400).json({ error: "title requerido" });
  if (!message) return res.status(400).json({ error: "message requerido" });

  const now = new Date().toISOString();
  const id = `cm_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  try {
    if (dbReady) {
      await pool.query("INSERT INTO uic_comms(id, title, message, created_at) VALUES($1,$2,$3,NOW())", [id, title, message]);
      await pruneDb();
      return res.status(201).json({ ok: true, item: { id, title, message, createdAt: now }, updatedAt: now });
    }
  } catch (e) {
    console.log("⚠️ DB comms/create error, fallback JSON:", e?.message || e);
  }

  COMMS_STORE.items.unshift({ id, title, message, createdAt: now });
  // mantener tamaño razonable (fallback JSON)
  COMMS_STORE.items = (COMMS_STORE.items || []).slice(0, COMMS_KEEP);
  touchCommsStore();
  return res.status(201).json({ ok: true, item: COMMS_STORE.items[0], updatedAt: COMMS_STORE.updatedAt });
});

app.delete("/comms/:id", requireAdmin, async (req, res) => {
  const id = (req.params.id || "").toString();

  try {
    if (dbReady) {
      const r = await pool.query("DELETE FROM uic_comms WHERE id=$1", [id]);
      if (!r.rowCount) return res.status(404).json({ error: "Mensaje no encontrado" });
      const now = new Date().toISOString();
      await pruneDb();
      return res.json({ ok: true, updatedAt: now });
    }
  } catch (e) {
    console.log("⚠️ DB comms/delete error, fallback JSON:", e?.message || e);
  }

  const before = COMMS_STORE.items.length;
  COMMS_STORE.items = (COMMS_STORE.items || []).filter((x) => x.id !== id);
  if (COMMS_STORE.items.length === before) return res.status(404).json({ error: "Mensaje no encontrado" });
  touchCommsStore();
  return res.json({ ok: true, updatedAt: COMMS_STORE.updatedAt });
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

async function start() {
  await initDb();

  app.listen(PORT, () => {
    console.log(`UIC API running on :${PORT}`);
    console.log(`WP_MODE=${WP_MODE} WP_SITE_BASE=${WP_SITE_BASE}`);
  });
}

start();
