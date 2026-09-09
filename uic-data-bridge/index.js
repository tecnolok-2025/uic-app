import express from "express";
import { Pool } from "pg";

const app = express();
const PORT = Number(process.env.PORT || 10000);
const PRIMARY_DATABASE_URL = String(process.env.PRIMARY_DATABASE_URL || "").trim();
const SECONDARY_DATABASE_URL = String(process.env.SECONDARY_DATABASE_URL || "").trim();
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || "").trim();
const DB_SSL = String(process.env.DATABASE_SSL || "true").trim().toLowerCase() !== "false";
const SYNC_INTERVAL_MS = Math.max(parseInt(process.env.SYNC_INTERVAL_MS || "900000", 10) || 900000, 300000);

const poolOpts = (connectionString, max=2) => ({
  connectionString,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

const primary = PRIMARY_DATABASE_URL ? new Pool(poolOpts(PRIMARY_DATABASE_URL, 2)) : null;
const secondary = SECONDARY_DATABASE_URL ? new Pool(poolOpts(SECONDARY_DATABASE_URL, 3)) : null;
let status = {
  primary: false, secondary: false, syncing: false,
  lastSyncAt: null, lastSuccessAt: null, lastError: "",
  counts: { events: 0, comms: 0, socios: 0 }
};

function safeIdentity(url) {
  try {
    if (!url) return { configured:false, host:"", database:"", user:"" };
    const u = new URL(url);
    return { configured:true, host:u.hostname, database:u.pathname.replace(/^\//,""), user:decodeURIComponent(u.username || "") };
  } catch { return { configured:Boolean(url), host:"URL inválida", database:"", user:"" }; }
}

async function ping(pool, which) {
  if (!pool) { status[which] = false; return false; }
  try { await pool.query("SELECT 1"); status[which] = true; return true; }
  catch (e) { status[which] = false; status.lastError = `${which}: ${String(e?.message || e)}`; return false; }
}

async function ensureSecondarySchema() {
  if (!(await ping(secondary, "secondary"))) return false;
  await secondary.query(`CREATE TABLE IF NOT EXISTS uic_events (
    id TEXT PRIMARY KEY, date DATE NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
    highlight BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await secondary.query(`CREATE INDEX IF NOT EXISTS uic_events_date_idx ON uic_events(date)`);
  await secondary.query(`CREATE TABLE IF NOT EXISTS uic_bridge_meta (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), last_success_at TIMESTAMPTZ,
    events_count INT NOT NULL DEFAULT 0, comms_count INT NOT NULL DEFAULT 0, socios_count INT NOT NULL DEFAULT 0)`);
  await secondary.query(`CREATE TABLE IF NOT EXISTS uic_comms (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await secondary.query(`CREATE TABLE IF NOT EXISTS uic_socios (
    id TEXT PRIMARY KEY, member_no INT NOT NULL UNIQUE, company_name TEXT NOT NULL, category TEXT NOT NULL,
    expertise TEXT DEFAULT '', website_url TEXT DEFAULT '', social_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  return true;
}

async function syncSnapshot() {
  if (status.syncing) return { ok:false, code:"sync_in_progress" };
  status.syncing = true;
  status.lastSyncAt = new Date().toISOString();
  try {
    if (!(await ping(primary, "primary"))) throw new Error(status.lastError || "Base principal no disponible");
    if (!(await ensureSecondarySchema())) throw new Error(status.lastError || "Base secundaria no disponible");

    const events = await primary.query("SELECT id,to_char(date,'YYYY-MM-DD') AS date,title,COALESCE(description,'') AS description,highlight,created_at,updated_at FROM uic_events ORDER BY date ASC");
    const comms = await primary.query("SELECT id,title,message,created_at FROM uic_comms ORDER BY created_at ASC");
    const socios = await primary.query("SELECT id,member_no,company_name,category,COALESCE(expertise,'') AS expertise,COALESCE(website_url,'') AS website_url,COALESCE(social_url,'') AS social_url,created_at,updated_at FROM uic_socios ORDER BY member_no ASC");

    const client = await secondary.connect();
    try {
      await client.query("BEGIN");
      for (const x of events.rows || []) {
        await client.query(`INSERT INTO uic_events(id,date,title,description,highlight,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET
          date=EXCLUDED.date,title=EXCLUDED.title,description=EXCLUDED.description,highlight=EXCLUDED.highlight,updated_at=EXCLUDED.updated_at`,
          [x.id,x.date,x.title,x.description,Boolean(x.highlight),x.created_at,x.updated_at]);
      }
      for (const x of comms.rows || []) {
        await client.query(`INSERT INTO uic_comms(id,title,message,created_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,message=EXCLUDED.message,created_at=EXCLUDED.created_at`,
          [x.id,x.title,x.message,x.created_at]);
      }
      for (const x of socios.rows || []) {
        await client.query(`INSERT INTO uic_socios(id,member_no,company_name,category,expertise,website_url,social_url,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET
          member_no=EXCLUDED.member_no,company_name=EXCLUDED.company_name,category=EXCLUDED.category,expertise=EXCLUDED.expertise,
          website_url=EXCLUDED.website_url,social_url=EXCLUDED.social_url,updated_at=EXCLUDED.updated_at`,
          [x.id,x.member_no,x.company_name,x.category,x.expertise,x.website_url,x.social_url,x.created_at,x.updated_at]);
      }

      // Agenda y socios son snapshots pequeños: reflejar también eliminaciones.
      const eventIds = (events.rows || []).map(x => x.id);
      if (eventIds.length) await client.query("DELETE FROM uic_events WHERE NOT (id = ANY($1::text[]))", [eventIds]);
      else await client.query("DELETE FROM uic_events");
      const socioIds = (socios.rows || []).map(x => x.id);
      if (socioIds.length) await client.query("DELETE FROM uic_socios WHERE NOT (id = ANY($1::text[]))", [socioIds]);
      else await client.query("DELETE FROM uic_socios");

      await client.query(`INSERT INTO uic_bridge_meta(singleton,last_success_at,events_count,comms_count,socios_count)
        VALUES(TRUE,NOW(),$1,$2,$3) ON CONFLICT(singleton) DO UPDATE SET
        last_success_at=EXCLUDED.last_success_at,events_count=EXCLUDED.events_count,comms_count=EXCLUDED.comms_count,socios_count=EXCLUDED.socios_count`,
        [events.rowCount || 0, comms.rowCount || 0, socios.rowCount || 0]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally { client.release(); }

    status.counts = { events:events.rowCount || 0, comms:comms.rowCount || 0, socios:socios.rowCount || 0 };
    status.lastSuccessAt = new Date().toISOString();
    status.lastError = "";
    console.log(`✅ UIC Data Bridge sync OK · agenda=${status.counts.events} comunicaciones=${status.counts.comms} socios=${status.counts.socios}`);
    return { ok:true, ...status.counts, at:status.lastSuccessAt };
  } catch (e) {
    status.lastError = String(e?.message || e);
    console.log(`⚠️ UIC Data Bridge sync pendiente: ${status.lastError}`);
    return { ok:false, error:status.lastError };
  } finally { status.syncing = false; }
}

app.disable("x-powered-by");
app.get("/", (req,res) => res.status(404).type("text/plain").send("Not Found"));
app.get("/health", async (req,res) => {
  await Promise.all([ping(primary,"primary"), ping(secondary,"secondary")]);
  res.json({
    ok: status.secondary,
    service: "UIC Data Bridge",
    mode: "internal-backup",
    primary: { configured:Boolean(PRIMARY_DATABASE_URL), connected:status.primary },
    secondary: { configured:Boolean(SECONDARY_DATABASE_URL), connected:status.secondary },
    syncing:status.syncing, lastSyncAt:status.lastSyncAt, lastSuccessAt:status.lastSuccessAt,
    counts:status.counts, lastError:status.lastError ? "sync_or_connection_error" : ""
  });
});
app.post("/sync", async (req,res) => {
  const token = String(req.header("x-bridge-token") || "").trim();
  if (!BRIDGE_TOKEN || token !== BRIDGE_TOKEN) return res.status(401).json({ ok:false, error:"unauthorized" });
  const r = await syncSnapshot();
  res.status(r.ok ? 200 : 503).json(r);
});

async function start() {
  if (!PRIMARY_DATABASE_URL || !SECONDARY_DATABASE_URL) console.log("⚠️ Falta PRIMARY_DATABASE_URL o SECONDARY_DATABASE_URL.");
  await ensureSecondarySchema().catch(()=>false);
  await syncSnapshot();
  app.listen(PORT, () => console.log(`UIC Data Bridge internal service on :${PORT} · sync=${SYNC_INTERVAL_MS}ms`));
  const t = setInterval(syncSnapshot, SYNC_INTERVAL_MS); t.unref?.();
}
start();
