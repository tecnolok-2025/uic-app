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

// Socios (directorio)
const SOCIOS_KEEP = Math.min(Math.max(parseInt(process.env.SOCIOS_KEEP || "500", 10) || 500, 50), 5000);

let dbReady = false;
let pool = null;

// Fallback JSON para socios (si no hay DB)
const SOCIOS_FILE = (process.env.SOCIOS_FILE || path.join(__dirname, "data", "socios.json")).trim();

function readSociosStore() {
  try {
    const raw = fs.readFileSync(SOCIOS_FILE, "utf-8");
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

function writeSociosStore(store) {
  ensureDir(path.dirname(SOCIOS_FILE));
  fs.writeFileSync(SOCIOS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

let SOCIOS_STORE = readSociosStore();

function touchSociosStore() {
  SOCIOS_STORE.updatedAt = new Date().toISOString();
  writeSociosStore(SOCIOS_STORE);
}

function normalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function pickBody(body, ...keys) {
  for (const k of keys) {
    if (body && Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined) return body[k];
  }
  return undefined;
}

function guessSocioCategory(companyName) {
  const n = String(companyName || "").toLowerCase();
  const has = (re) => re.test(n);

  // Logística / transporte / portuario
  if (
    has(/transporte|logisti|camion|camioner|bus\b|ruta\b|portuar|naval|astillero|fluvial|puerto/) ||
    has(/master bus|bus pla/)
  ) {
    return { category: "logistica", expertise: "Logística y transporte" };
  }

  // Servicios (seguros, estudios, consultoría, hotelería, inmobiliaria, brokers)
  if (
    has(/servicio|seguro|estudio|consult|broker|hotel|inmobiliaria|cooperativa|valerio|orbe|villaberde/) ||
    has(/colmena|plan\s*ercitec/) ||
    has(/affinity/) ||
    has(/praxis finanzas/)
  ) {
    return { category: "servicios", expertise: "Servicios profesionales" };
  }

  // Fabricación / industria (default)
  if (
    has(/industr|metal|quim|plast|maderer|rodamiento|hierro|gases|abertura|plegado|montaje|suelos|roca(d)?\b|technik|ciani|titania|ultracolor|indapco|inteco|alucam|dipsol|dem\b|quimigas/) ||
    has(/insadi|technia|tecmaco|nepar|suppress|pastoriza|comibor|qbox|kiub|ecogoal|inventiva/) ||
    has(/interacero|integral\s*k/)
  ) {
    return { category: "fabricacion", expertise: "Industria y manufactura" };
  }

  return { category: "servicios", expertise: "Servicios" };
}

// Seed inicial de socios (solo número + empresa; sin CUIT/email por confidencialidad)
// Notas:
// - La categoría por defecto se infiere por heurística (nombre).
// - Para casos particulares (p.ej. "Tecno Logisti-K"), se definen overrides manuales.
const SOCIO_OVERRIDES = {
  // Ejemplo validado: Tecno Logisti-K = Ingeniería / Consultoría profesional (Servicios)
  101: {
    category: "servicios",
    expertise: "Ingeniería y consultoría profesional",
    website_url: "https://www.tecnolok.com.ar",
    social_url: "",
  },
};

const SOCIOS_SEED = [
  { member_no: 1, company_name: "INSADI S.A." },
  { member_no: 3, company_name: "MOTORES ELECTRICOS Y COMANDOS SA" },
  { member_no: 4, company_name: "JUSA S.A." },
  { member_no: 7, company_name: "JCO S.R.L." },
  { member_no: 9, company_name: "JM PLEGADOS" },
  { member_no: 12, company_name: "MADERERA CAMPANA SA" },
  { member_no: 13, company_name: "BUS PLA" },
  { member_no: 16, company_name: "MIGUELES CARLOS SA" },
  { member_no: 20, company_name: "AMEGHINO SERVICIOS NAVAL E INDUSTRIAL SA" },
  { member_no: 21, company_name: "NORBERTO D. RIVERO S.A./TITANIA" },
  { member_no: 22, company_name: "TECHNIA S.A." },
  { member_no: 37, company_name: "SUELOS ARGENTINOS - SASA SA" },
  { member_no: 38, company_name: "EXPO ARGENTINA S.R.L" },
  { member_no: 41, company_name: "RODBUL RODAMIENTOS" },
  { member_no: 42, company_name: "AUDITEC ARGENTINA SA" },
  { member_no: 43, company_name: "TRANSPORTES PADILLA S.A" },
  { member_no: 44, company_name: "TECMACO INTEGRAL SA" },
  { member_no: 46, company_name: "LEOPOLDO CIANI E HIJOS S.A." },
  { member_no: 50, company_name: "RIO MANSO S.A." },
  { member_no: 51, company_name: "GASES CAMPANA SA" },
  { member_no: 53, company_name: "HIERROS CAMPANA SA" },
  { member_no: 54, company_name: "ULTRACOLOR SA" },
  { member_no: 56, company_name: "MASTER BUS SA" },
  { member_no: 58, company_name: "INDAPCO SA" },
  { member_no: 67, company_name: "MONTAJES INTERACERO SA" },
  { member_no: 69, company_name: "SANTA CHITA EDUARDO" },
  { member_no: 72, company_name: "RZ SERVICIOS INDUSTRIALES SA" },
  { member_no: 77, company_name: "ALDO DI LALLO SA" },
  { member_no: 78, company_name: "MONTAJES NEPAR SA" },
  { member_no: 81, company_name: "INTEGER PRAESTATIO SRL" },
  { member_no: 84, company_name: "INDUCCIÖN SRL" },
  { member_no: 88, company_name: "AVILA ARGENTINA SA" },
  { member_no: 92, company_name: "PLAZA HOTEL CAMPANA SA" },
  { member_no: 101, company_name: "TECNO LOGISTI-K SA" },
  { member_no: 103, company_name: "ALUCAM ABERTURAS" },
  { member_no: 115, company_name: "INDUSTRIAS QUIMICAS DEM SA" },
  { member_no: 128, company_name: "QUIMIGAS SAIC" },
  { member_no: 130, company_name: "INGECAMP SA" },
  { member_no: 133, company_name: "C Y L ELECTROMATERIAL SA" },
  { member_no: 140, company_name: "SIZNO TECHNOLOGIE" },
  { member_no: 146, company_name: "EL HOGAR FERRETERIA" },
  { member_no: 148, company_name: "METAL TECHNIK SA" },
  { member_no: 152, company_name: "VILENI SRL" },
  { member_no: 164, company_name: "NOVASEN S.A." },
  { member_no: 168, company_name: "I-MEGA INGENIERIA" },
  { member_no: 169, company_name: "DIPSOL SRL" },
  { member_no: 173, company_name: "INMOBILIARIA CADEMA SA" },
  { member_no: 177, company_name: "BERSABAR SA" },
  { member_no: 180, company_name: "QBOX" },
  { member_no: 185, company_name: "RAYBITE INGENIERIA" },
  { member_no: 187, company_name: "INTECO ARGENTINA" },
  { member_no: 195, company_name: "ALQUIVIAL" },
  { member_no: 197, company_name: "TRIMSA SRL" },
  { member_no: 198, company_name: "SUPPRESS" },
  { member_no: 200, company_name: "LA PASTORIZA S.A." },
  { member_no: 201, company_name: "ALTOS DE VILLA NUEVA SRL" },
  { member_no: 203, company_name: "ASTILLERO ALNAVI" },
  { member_no: 204, company_name: "SERVICIOS INTEGRADOS PORTUARIOS" },
  { member_no: 205, company_name: "CONSTELMEC S.A." },
  { member_no: 207, company_name: "CAMPASI S.A.S." },
  { member_no: 210, company_name: "SWA" },
  { member_no: 211, company_name: "VILLABERDE SEGUROS" },
  { member_no: 215, company_name: "TEGA DESARROLLO S.R.L." },
  { member_no: 216, company_name: "GRUPO BAUTEC S.A." },
  { member_no: 217, company_name: "INTEGRAL K" },
  { member_no: 221, company_name: "PARQUE PYME SA" },
  { member_no: 223, company_name: "ESTUDIO CONTABLE FERNANDO FERREYRA" },
  { member_no: 224, company_name: "IPR PLASTICOS REFORZADOS" },
  { member_no: 225, company_name: "INFO VALERIO" },
  { member_no: 226, company_name: "CONEXIÓN CONSULTORA (Tte. Fluvial Bs As Uruguay)" },
  { member_no: 227, company_name: "COOPERATIVA ELECTRICA ZARATE" },
  { member_no: 228, company_name: "TALLER METALURGICO RIMA SA" },
  { member_no: 229, company_name: "TECHNICI SRL" },
  { member_no: 230, company_name: "PRAXIS FINANZAS SA" },
  { member_no: 231, company_name: "BELLCOM" },
  { member_no: 232, company_name: "COMIBOR SA" },
  { member_no: 233, company_name: "Quadecon Industrial Services S.A." },
  { member_no: 234, company_name: "AFFINITY BROKER S.A." },
  { member_no: 235, company_name: "RUBEN DOMENECH" },
  { member_no: 236, company_name: "FERRARO Y ASOCIADOS SRL" },
  { member_no: 237, company_name: "CHETANA" },
  { member_no: 238, company_name: "PAPELITOS GRAFICA" },
  { member_no: 239, company_name: "S & S MMONTAJES INDUSTRIALES SA" },
  { member_no: 240, company_name: "ROCAD 3D SRL" },
  { member_no: 241, company_name: "KIUB SA" },
  { member_no: 242, company_name: "INVENTIVA" },
  { member_no: 243, company_name: "ECOGOAL" },
  { member_no: 244, company_name: "GRUPO SOLPER" },
  { member_no: 245, company_name: "DEBORA BIAIN - COLMENA 360" },
  { member_no: 246, company_name: "MARCELO VILA - PLAN ERCITEC" },
  { member_no: 247, company_name: "PECANTECH" },
  { member_no: 248, company_name: "ESTUDIO ORBE DE SERVICIOS EMPRESARIOS SA" },
  { member_no: 249, company_name: "HOTEL RUTA 6" },
];

function getSocioDefaultsFromSeed(seed) {
  const o = SOCIO_OVERRIDES[Number(seed?.member_no)] || null;
  const g = guessSocioCategory(seed.company_name);
  return {
    category: (o?.category || g.category || "servicios"),
    expertise: (o?.expertise || g.expertise || ""),
    website_url: (o?.website_url || ""),
    social_url: (o?.social_url || ""),
  };
}

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS uic_socios (
        id TEXT PRIMARY KEY,
        member_no INT NOT NULL UNIQUE,
        company_name TEXT NOT NULL,
        category TEXT NOT NULL,
        expertise TEXT DEFAULT '',
        website_url TEXT DEFAULT '',
        social_url TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS uic_socios_category_idx ON uic_socios(category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS uic_socios_name_idx ON uic_socios(LOWER(company_name))`);

    dbReady = true;
    console.log("✅ DB externa habilitada (DATABASE_URL). Persistencia OK.");
  } catch (e) {
    dbReady = false;
    console.log("⚠️ DB externa no disponible, usando JSON local:", e?.message || e);
  }
}

async function seedSociosIfEmpty() {
  // DB
  if (dbReady) {
    try {
      const r = await pool.query("SELECT COUNT(*)::int AS count FROM uic_socios");
      const count = r.rows?.[0]?.count || 0;
      if (count > 0) return;

      for (const s of SOCIOS_SEED) {
        const g = getSocioDefaultsFromSeed(s);
        const id = `soc_${s.member_no}`;
        await pool.query(
          `INSERT INTO uic_socios (id, member_no, company_name, category, expertise, website_url, social_url)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (member_no) DO NOTHING`,
          [id, s.member_no, s.company_name, g.category, g.expertise || "", g.website_url || "", g.social_url || ""]
        );
      }
      console.log(`✅ Socios seed inicial cargado (${SOCIOS_SEED.length}).`);
      return;
    } catch (e) {
      console.log("⚠️ seedSociosIfEmpty DB error:", e?.message || e);
    }
  }

  // JSON fallback
  try {
    if ((SOCIOS_STORE.items || []).length > 0) return;
    SOCIOS_STORE.items = SOCIOS_SEED.map((s) => {
      const g = getSocioDefaultsFromSeed(s);
      return {
        id: `soc_${s.member_no}`,
        member_no: s.member_no,
        company_name: s.company_name,
        category: g.category,
        expertise: g.expertise || "",
        website_url: g.website_url || "",
        social_url: g.social_url || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });
    touchSociosStore();
    console.log(`✅ Socios seed inicial cargado en JSON (${SOCIOS_SEED.length}).`);
  } catch (_) {}
}

// Aplica correcciones manuales (overrides) aunque la tabla ya tenga datos.
// Se usa para ajustar casos especiales sin depender de que la DB esté vacía.
async function applySocioOverrides() {
  const keys = Object.keys(SOCIO_OVERRIDES || {});
  if (!keys.length) return;

  // DB
  if (dbReady) {
    try {
      for (const k of keys) {
        const memberNo = Number(k);
        const o = SOCIO_OVERRIDES[memberNo];
        if (!o) continue;
        await pool.query(
          `UPDATE uic_socios
             SET category = COALESCE($2, category),
                 expertise = COALESCE($3, expertise),
                 website_url = COALESCE($4, website_url),
                 social_url = COALESCE($5, social_url),
                 updated_at = NOW()
           WHERE member_no = $1`,
          [memberNo, o.category || null, o.expertise || null, o.website_url || null, o.social_url || null]
        );
      }
      return;
    } catch (e) {
      console.log("⚠️ applySocioOverrides DB error:", e?.message || e);
    }
  }

  // JSON fallback
  try {
    for (const k of keys) {
      const memberNo = Number(k);
      const o = SOCIO_OVERRIDES[memberNo];
      const it = (SOCIOS_STORE.items || []).find((x) => Number(x.member_no) === memberNo);
      if (!it || !o) continue;
      if (o.category) it.category = o.category;
      if (o.expertise) it.expertise = o.expertise;
      if (o.website_url) it.website_url = o.website_url;
      if (o.social_url) it.social_url = o.social_url;
      it.updated_at = new Date().toISOString();
    }
    touchSociosStore();
  } catch (_) {}
}


async function pruneDb() {
  const w = agendaWindowBounds();

  // Fallback JSON: prune siempre
  try {
    EVENTS_STORE.events = (EVENTS_STORE.events || []).filter((ev) => ev.date >= w.start && ev.date <= w.end);
    // orden ascendente por fecha
    EVENTS_STORE.events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // COMMS fallback: mantener últimas COMMS_KEEP
    COMMS_STORE.items = (COMMS_STORE.items || []).slice(0, COMMS_KEEP);
  } catch (_) {}

  if (!dbReady) return;

  try {
    // Agenda: mantener ventana móvil (mes actual -> +12 meses)
    await pool.query("DELETE FROM uic_events WHERE date < $1 OR date > $2", [w.start, w.end]);

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


function agendaWindowBounds() {
  // Ventana móvil: mes actual -> +12 meses hacia adelante (incluye 12 meses: mes actual + 11)
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 12, 0); // último día del mes (mes+11)
  const toIso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  return { start: toIso(start), end: toIso(end) };
}

function clampRangeToWindow(from, to) {
  const w = agendaWindowBounds();
  const f = from && from > w.start ? from : w.start;
  const t = to && to < w.end ? to : w.end;
  return { from: f, to: t, window: w };
}

function isWithinWindow(dateStr) {
  const w = agendaWindowBounds();
  return !!dateStr && dateStr >= w.start && dateStr <= w.end;
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

/* ------------------------- WordPress (posts) ---------------------------- */

app.get("/wp/categories", async (req, res) => {
  // Para la UI actual no es crítico; devolvemos un set mínimo consistente.
  return res.json({
    items: [
      { slug: "beneficios", name: "Beneficios" },
      { slug: "eventos", name: "Eventos" },
      { slug: "promocion-industrial", name: "Promoción industrial" },
      { slug: "institucional", name: "Institucional" },
    ],
  });
});

app.get("/wp/posts", async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(req.query.per_page || "6", 10) || 6, 1), 20);
  const limitTotal = Math.min(Math.max(parseInt(req.query.limit_total || "100", 10) || 100, 1), 300);
  const q = (req.query.search || req.query.q || "").toString().trim().toLowerCase();
  const category = (req.query.category || "").toString().trim().toLowerCase();

  try {
    let feedUrl = WP_FEED_URL;
    if (category) {
      feedUrl = `${WP_SITE_BASE}/category/${encodeURIComponent(category)}/feed/`;
    }
    // WordPress soporta paginación para feeds vía ?paged=
    const url = new URL(feedUrl);
    if (page > 1) url.searchParams.set("paged", String(page));

    let items = await fetchRssItems(url.toString());

    if (category) {
      items = items.filter((p) => (p.category_slugs || []).includes(category));
    }
    if (q) {
      items = items.filter((p) => {
        const t = (p.title || "").toLowerCase();
        const e = (p.excerpt || "").toLowerCase();
        return t.includes(q) || e.includes(q);
      });
    }

    // En RSS el total real es difícil; usamos limitTotal como techo UI
    const start = 0;
    const sliced = items.slice(start, start + perPage);

    const has_more = items.length >= perPage; // heurística
    const next_page = has_more ? page + 1 : null;

    return res.json({
      page,
      per_page: perPage,
      limit_total: limitTotal,
      has_more,
      next_page,
      items: sliced,
    });
  } catch (e) {
    console.log("⚠️ wp/posts error:", e?.message || e);
    return res.status(502).json({ error: "No se pudo obtener el feed" });
  }
});



/* ----------------------------- Eventos --------------------------------- */

app.get("/events/meta", async (req, res) => {
  const w = agendaWindowBounds();
  try {
    await pruneDb();
    if (dbReady) {
      const r = await pool.query(
        "SELECT COUNT(*)::int AS count, MAX(updated_at) AS updated_at FROM uic_events WHERE date >= $1 AND date <= $2",
        [w.start, w.end]
      );
      const count = r.rows?.[0]?.count || 0;
      const updatedAt = r.rows?.[0]?.updated_at ? new Date(r.rows[0].updated_at).toISOString() : "";
      return res.json({ updatedAt, count });
    }
  } catch (e) {
    console.log("⚠️ DB events/meta error, fallback JSON:", e?.message || e);
  }
  // fallback JSON (ya pruned)
  return res.json({ updatedAt: EVENTS_STORE.updatedAt, count: (EVENTS_STORE.events || []).length });
});

app.get("/events", async (req, res) => {
  const qFrom = isoDateOnly((req.query.from || "").toString().trim());
  const qTo = isoDateOnly((req.query.to || "").toString().trim());
  const { from, to, window } = clampRangeToWindow(qFrom, qTo);

  if (from && to && from > to) {
    return res.json({ updatedAt: EVENTS_STORE.updatedAt, items: [] });
  }

  try {
    await pruneDb();
    if (dbReady) {
      const r = await pool.query(
        "SELECT id, to_char(date,'YYYY-MM-DD') AS date, title, COALESCE(description,'') AS description, highlight, created_at, updated_at FROM uic_events WHERE date >= $1 AND date <= $2 ORDER BY date ASC",
        [from, to]
      );

      const items = (r.rows || []).map((x) => ({
        id: x.id,
        date: x.date,
        title: x.title,
        description: x.description || "",
        highlight: Boolean(x.highlight),
        createdAt: x.created_at ? new Date(x.created_at).toISOString() : "",
        updatedAt: x.updated_at ? new Date(x.updated_at).toISOString() : "",
      }));

      const meta = await pool.query("SELECT MAX(updated_at) AS updated_at FROM uic_events WHERE date >= $1 AND date <= $2", [window.start, window.end]);
      const updatedAt = meta.rows?.[0]?.updated_at ? new Date(meta.rows[0].updated_at).toISOString() : "";

      return res.json({ updatedAt, items });
    }
  } catch (e) {
    console.log("⚠️ DB events/list error, fallback JSON:", e?.message || e);
  }

  // fallback JSON (ya pruned)
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
  if (!isWithinWindow(date)) return res.status(400).json({ error: "date fuera de la ventana móvil (mes actual -> +12 meses)" });
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
  if (!isWithinWindow(newDate)) return res.status(400).json({ error: "date fuera de la ventana móvil (mes actual -> +12 meses)" });
      if (!isWithinWindow(newDate)) return res.status(400).json({ error: "date fuera de la ventana móvil (mes actual -> +12 meses)" });
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
  if (!isWithinWindow(newDate)) return res.status(400).json({ error: "date fuera de la ventana móvil (mes actual -> +12 meses)" });
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
  let title = (req.body?.title || "").toString().trim();
  const message = (req.body?.message || "").toString().trim();

  // WhatsApp-like: el título es opcional. Si viene vacío, usamos uno por defecto.
  if (!title) title = "Comunicado";
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


/* ----------------------------- Socios ---------------------------------- */

app.get("/socios/meta", async (req, res) => {
  try {
    if (dbReady) {
      const r = await pool.query("SELECT COUNT(*)::int AS count, MAX(updated_at) AS updated_at FROM uic_socios");
      const count = r.rows?.[0]?.count || 0;
      const updatedAt = r.rows?.[0]?.updated_at ? new Date(r.rows[0].updated_at).toISOString() : "";
      return res.json({ count, updatedAt });
    }
  } catch (e) {
    console.log("⚠️ DB socios/meta error, fallback JSON:", e?.message || e);
  }
  return res.json({ count: (SOCIOS_STORE.items || []).length, updatedAt: SOCIOS_STORE.updatedAt });
});


app.get("/socios", async (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
  // Soportar edición masiva (grilla) desde el frontend admin.
  const perPage = Math.min(Math.max(parseInt(req.query.per_page || "25", 10) || 25, 5), 200);
  const category = (req.query.category || "").toString().trim().toLowerCase();
  const q = (req.query.q || "").toString().trim().toLowerCase();

  const offset = (page - 1) * perPage;

  // DB
  if (dbReady) {
    try {
      const where = [];
      const vals = [];
      let idx = 1;
      if (category && category !== "todos") {
        where.push(`category = $${idx++}`);
        vals.push(category);
      }
      if (q) {
        where.push(`(LOWER(company_name) LIKE $${idx} OR CAST(member_no AS TEXT) LIKE $${idx})`);
        vals.push(`%${q}%`);
        idx++;
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      // total limitado para paginación
      const totalR = await pool.query(`SELECT COUNT(*)::int AS total FROM uic_socios ${whereSql}`, vals);
      const total = totalR.rows?.[0]?.total || 0;

      vals.push(perPage);
      vals.push(offset);
      const listR = await pool.query(
        `SELECT id, member_no, company_name, category, expertise, website_url, social_url, created_at, updated_at
         FROM uic_socios
         ${whereSql}
         ORDER BY member_no ASC
         LIMIT $${idx++} OFFSET $${idx++}`,
        vals
      );

      const items = (listR.rows || []).map((r) => ({
        id: r.id,
        member_no: r.member_no,
        company_name: r.company_name,
        category: r.category,
        expertise: r.expertise || "",
        website_url: r.website_url || "",
        social_url: r.social_url || "",
        created_at: r.created_at ? new Date(r.created_at).toISOString() : "",
        updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : "",
      }));

      const has_more = offset + items.length < total;
      const next_page = has_more ? page + 1 : null;

      return res.json({ page, per_page: perPage, total, has_more, next_page, items });
    } catch (e) {
      console.log("⚠️ DB socios/list error, fallback JSON:", e?.message || e);
    }
  }

  // JSON fallback
  let items = (SOCIOS_STORE.items || []).slice();
  if (category && category !== "todos") items = items.filter((x) => (x.category || "").toLowerCase() === category);
  if (q) {
    items = items.filter((x) => {
      const n = String(x.company_name || "").toLowerCase();
      const mn = String(x.member_no || "");
      return n.includes(q) || mn.includes(q);
    });
  }
  items.sort((a, b) => (a.member_no || 0) - (b.member_no || 0));
  const total = items.length;
  const paged = items.slice(offset, offset + perPage);
  const has_more = offset + paged.length < total;
  const next_page = has_more ? page + 1 : null;
  return res.json({ page, per_page: perPage, total, has_more, next_page, items: paged });
});

// Export planilla (CSV) para edición offline (Excel/Google Sheets) y re-import vía /socios/bulk.
// Requiere clave admin porque incluye URLs y expertise (aunque no incluye CUIT ni emails).
app.get("/socios/export.csv", requireAdmin, async (req, res) => {
  const esc = (v) => {
    const s = String(v ?? "");
    // CSV standard escaping
    if (/[\n\r\",;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  try {
    let items = [];
    if (dbReady) {
      const r = await pool.query(
        `SELECT member_no, company_name, category,
                COALESCE(expertise,'') AS expertise,
                COALESCE(website_url,'') AS website_url,
                COALESCE(social_url,'') AS social_url
         FROM uic_socios
         ORDER BY member_no ASC`
      );
      items = (r.rows || []).map((x) => ({
        member_no: x.member_no,
        company_name: x.company_name,
        category: x.category,
        expertise: x.expertise || "",
        website_url: x.website_url || "",
        social_url: x.social_url || "",
      }));
    } else {
      items = (SOCIOS_STORE.items || []).slice().sort((a, b) => (a.member_no || 0) - (b.member_no || 0));
    }

    const header = ["member_no", "company_name", "category", "expertise", "website_url", "social_url"].join(",");

    const rows = items.map((it) =>
      [
        esc(it.member_no),
        esc(it.company_name),
        esc(it.category),
        esc(it.expertise),
        esc(it.website_url),
        esc(it.social_url),
      ].join(",")
    );

    const csv = [header, ...rows].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="uic_socios.csv"');
    return res.send(csv);
  } catch (e) {
    console.log("⚠️ socios/export.csv error:", e?.message || e);
    return res.status(500).json({ error: "export_failed" });
  }
});


app.post("/socios", requireAdmin, async (req, res) => {
  const memberNo = parseInt(pickBody(req.body, 'memberNo', 'member_no'), 10);
  const companyName = String(pickBody(req.body, 'companyName', 'company_name') || "").trim();
  const category = String(pickBody(req.body, 'category') || "").trim().toLowerCase();
  const expertise = String(pickBody(req.body, 'expertise') || "").trim();
  const websiteUrl = normalizeUrl(pickBody(req.body, 'websiteUrl', 'website_url'));
  const socialUrl = normalizeUrl(pickBody(req.body, 'socialUrl', 'social_url'));

  if (!Number.isFinite(memberNo) || memberNo <= 0) return res.status(400).json({ error: "memberNo inválido" });
  if (!companyName) return res.status(400).json({ error: "companyName requerido" });

  const validCategories = new Set(["logistica", "fabricacion", "servicios"]);
  const cat = validCategories.has(category) ? category : guessSocioCategory(companyName).category;
  const exp = expertise || guessSocioCategory(companyName).expertise || "";

  const id = `soc_${memberNo}_${Math.random().toString(36).slice(2, 8)}`;

  // DB
  if (dbReady) {
    try {
      await pool.query(
        `INSERT INTO uic_socios (id, member_no, company_name, category, expertise, website_url, social_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, memberNo, companyName, cat, exp, websiteUrl, socialUrl]
      );
      return res.json({ ok: true, id });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/unique/i.test(msg)) return res.status(409).json({ error: "memberNo ya existe" });
      console.log("⚠️ DB socios/create error, fallback JSON:", msg);
    }
  }

  // JSON fallback
  if ((SOCIOS_STORE.items || []).some((x) => Number(x.member_no) === memberNo)) {
    return res.status(409).json({ error: "memberNo ya existe" });
  }
  SOCIOS_STORE.items.unshift({
    id,
    member_no: memberNo,
    company_name: companyName,
    category: cat,
    expertise: exp,
    website_url: websiteUrl,
    social_url: socialUrl,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  SOCIOS_STORE.items = SOCIOS_STORE.items.slice(0, SOCIOS_KEEP);
  touchSociosStore();
  return res.json({ ok: true, id });
});


app.post("/socios/bulk", requireAdmin, async (req, res) => {
  const rawItems = req.body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return res.status(400).json({ error: "items requerido (array)" });
  }

  const validCategories = new Set(["logistica", "fabricacion", "servicios"]);
  const items = rawItems
    .map((it) => {
      const memberNo = parseInt(pickBody(it, "memberNo", "member_no"), 10);
      const companyName = String(pickBody(it, "companyName", "company_name") || "").trim();
      const category = String(pickBody(it, "category") || "").trim().toLowerCase();
      const expertise = String(pickBody(it, "expertise") || "").trim();
      const websiteUrl = normalizeUrl(pickBody(it, "websiteUrl", "website_url"));
      const socialUrl = normalizeUrl(pickBody(it, "socialUrl", "social_url"));
      const id = String(pickBody(it, "id") || "").trim() || null;

      if (!Number.isFinite(memberNo) || memberNo <= 0) return null;
      if (!companyName) return null;

      const cat = validCategories.has(category) ? category : guessSocioCategory(companyName).category;
      const exp = expertise || guessSocioCategory(companyName).expertise || "";

      return { id, memberNo, companyName, cat, exp, websiteUrl, socialUrl };
    })
    .filter(Boolean);

  if (!items.length) return res.status(400).json({ error: "items inválidos" });

  if (dbReady) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const it of items) {
        const found = await client.query("SELECT id FROM uic_socios WHERE member_no = $1 LIMIT 1", [it.memberNo]);
        const existingId = found.rows?.[0]?.id || null;
        if (existingId) {
          await client.query(
            `UPDATE uic_socios
               SET company_name = $2,
                   category = $3,
                   expertise = $4,
                   website_url = $5,
                   social_url = $6,
                   updated_at = NOW()
             WHERE id = $1`,
            [existingId, it.companyName, it.cat, it.exp, it.websiteUrl, it.socialUrl]
          );
        } else {
          const newId = it.id || `soc_${it.memberNo}_${Math.random().toString(36).slice(2, 8)}`;
          await client.query(
            `INSERT INTO uic_socios (id, member_no, company_name, category, expertise, website_url, social_url)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [newId, it.memberNo, it.companyName, it.cat, it.exp, it.websiteUrl, it.socialUrl]
          );
        }
      }
      await client.query("COMMIT");
      return res.json({ ok: true, count: items.length });
    } catch (e) {
      await client.query("ROLLBACK");
      console.log("⚠️ DB socios/bulk error, fallback JSON:", e?.message || e);
    } finally {
      client.release();
    }
  }

  const byNo = new Map((SOCIOS_STORE.items || []).map((x) => [Number(x.member_no), x]));
  for (const it of items) {
    const existing = byNo.get(it.memberNo);
    if (existing) {
      existing.company_name = it.companyName;
      existing.category = it.cat;
      existing.expertise = it.exp;
      existing.website_url = it.websiteUrl;
      existing.social_url = it.socialUrl;
      existing.updated_at = new Date().toISOString();
    } else {
      const newId = it.id || `soc_${it.memberNo}_${Math.random().toString(36).slice(2, 8)}`;
      const obj = {
        id: newId,
        member_no: it.memberNo,
        company_name: it.companyName,
        category: it.cat,
        expertise: it.exp,
        website_url: it.websiteUrl,
        social_url: it.socialUrl,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      SOCIOS_STORE.items.unshift(obj);
      byNo.set(it.memberNo, obj);
    }
  }
  SOCIOS_STORE.items.sort((a, b) => (a.member_no || 0) - (b.member_no || 0));
  SOCIOS_STORE.items = SOCIOS_STORE.items.slice(0, SOCIOS_KEEP);
  touchSociosStore();
  return res.json({ ok: true, count: items.length });
});


app.put("/socios/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id requerido" });

  const memberNo = pickBody(req.body, 'memberNo', 'member_no') !== undefined ? parseInt(pickBody(req.body, 'memberNo', 'member_no'), 10) : null;
  const companyName = pickBody(req.body, 'companyName', 'company_name') !== undefined ? String(pickBody(req.body, 'companyName', 'company_name') || "").trim() : null;
  const category = req.body?.category !== undefined ? String(req.body.category || "").trim().toLowerCase() : null;
  const expertise = req.body?.expertise !== undefined ? String(req.body.expertise || "").trim() : null;
  const websiteUrl = pickBody(req.body, 'websiteUrl', 'website_url') !== undefined ? normalizeUrl(pickBody(req.body, 'websiteUrl', 'website_url')) : null;
  const socialUrl = pickBody(req.body, 'socialUrl', 'social_url') !== undefined ? normalizeUrl(pickBody(req.body, 'socialUrl', 'social_url')) : null;

  const validCategories = new Set(["logistica", "fabricacion", "servicios"]);

  // DB
  if (dbReady) {
    try {
      const sets = [];
      const vals = [];
      let idx = 1;
      if (memberNo !== null) {
        if (!Number.isFinite(memberNo) || memberNo <= 0) return res.status(400).json({ error: "memberNo inválido" });
        sets.push(`member_no = $${idx++}`);
        vals.push(memberNo);
      }
      if (companyName !== null) {
        if (!companyName) return res.status(400).json({ error: "companyName requerido" });
        sets.push(`company_name = $${idx++}`);
        vals.push(companyName);
      }
      if (category !== null) {
        const c = validCategories.has(category) ? category : null;
        if (!c) return res.status(400).json({ error: "category inválida" });
        sets.push(`category = $${idx++}`);
        vals.push(c);
      }
      if (expertise !== null) {
        sets.push(`expertise = $${idx++}`);
        vals.push(expertise);
      }
      if (websiteUrl !== null) {
        sets.push(`website_url = $${idx++}`);
        vals.push(websiteUrl);
      }
      if (socialUrl !== null) {
        sets.push(`social_url = $${idx++}`);
        vals.push(socialUrl);
      }
      sets.push(`updated_at = NOW()`);
      if (!sets.length) return res.json({ ok: true });

      vals.push(id);
      const r = await pool.query(`UPDATE uic_socios SET ${sets.join(", ")} WHERE id = $${idx} `, vals);
      if (!r.rowCount) return res.status(404).json({ error: "Socio no encontrado" });
      return res.json({ ok: true });
    } catch (e) {
      const msg = e?.message || String(e);
      if (/unique/i.test(msg)) return res.status(409).json({ error: "memberNo ya existe" });
      console.log("⚠️ DB socios/update error, fallback JSON:", msg);
    }
  }

  // JSON fallback
  const idx = (SOCIOS_STORE.items || []).findIndex((x) => x.id === id);
  if (idx < 0) return res.status(404).json({ error: "Socio no encontrado" });

  if (memberNo !== null) {
    if (!Number.isFinite(memberNo) || memberNo <= 0) return res.status(400).json({ error: "memberNo inválido" });
    if ((SOCIOS_STORE.items || []).some((x) => x.id !== id && Number(x.member_no) === memberNo)) {
      return res.status(409).json({ error: "memberNo ya existe" });
    }
    SOCIOS_STORE.items[idx].member_no = memberNo;
  }
  if (companyName !== null) {
    if (!companyName) return res.status(400).json({ error: "companyName requerido" });
    SOCIOS_STORE.items[idx].company_name = companyName;
  }
  if (category !== null) {
    if (!validCategories.has(category)) return res.status(400).json({ error: "category inválida" });
    SOCIOS_STORE.items[idx].category = category;
  }
  if (expertise !== null) SOCIOS_STORE.items[idx].expertise = expertise;
  if (websiteUrl !== null) SOCIOS_STORE.items[idx].website_url = websiteUrl;
  if (socialUrl !== null) SOCIOS_STORE.items[idx].social_url = socialUrl;
  SOCIOS_STORE.items[idx].updated_at = new Date().toISOString();
  touchSociosStore();
  return res.json({ ok: true });
});


app.delete("/socios/:id", requireAdmin, async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ error: "id requerido" });

  if (dbReady) {
    try {
      const r = await pool.query("DELETE FROM uic_socios WHERE id = $1", [id]);
      if (!r.rowCount) return res.status(404).json({ error: "Socio no encontrado" });
      return res.json({ ok: true });
    } catch (e) {
      console.log("⚠️ DB socios/delete error, fallback JSON:", e?.message || e);
    }
  }

  const before = (SOCIOS_STORE.items || []).length;
  SOCIOS_STORE.items = (SOCIOS_STORE.items || []).filter((x) => x.id !== id);
  if ((SOCIOS_STORE.items || []).length === before) return res.status(404).json({ error: "Socio no encontrado" });
  touchSociosStore();
  return res.json({ ok: true });
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
  await seedSociosIfEmpty();
  await applySocioOverrides();
  await pruneDb();

  app.listen(PORT, () => {
    console.log(`UIC API running on :${PORT}`);
    console.log(`WP_MODE=${WP_MODE} WP_SITE_BASE=${WP_SITE_BASE}`);
  });
}

start();
