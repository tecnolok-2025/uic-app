import React, { useEffect, useMemo, useState } from "react";
import "./index.css";
import logoUIC from "./assets/logo-uic.jpeg";

const API_BASE = import.meta.env.VITE_API_BASE || ""; // ej: https://uic-campana-api.onrender.com

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

function normalizePost(p) {
  // Soporta:
  // - WordPress REST: { id, title: {rendered}, excerpt: {rendered}, date, link, ... }
  // - RSS normalizado por backend: { id, title, excerpt, date, link, image, categories, ... }
  const id = p?.id ?? p?.guid ?? p?.link ?? Math.random().toString(36);
  const title =
    typeof p?.title === "string"
      ? p.title
      : (p?.title?.rendered || "").replace(/<[^>]+>/g, "");
  const excerpt =
    typeof p?.excerpt === "string"
      ? p.excerpt
      : (p?.excerpt?.rendered || "").replace(/<[^>]+>/g, "");
  const link = p?.link || "";
  const date = p?.date || p?.pubDate || "";
  const image = p?.image || p?.yoast_head_json?.og_image?.[0]?.url || "";
  const categories = p?.categories || [];
  return { id, title, excerpt, link, date, image, categories };
}

async function apiGet(path) {
  const r = await fetch(`${API_BASE}${path}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.message || data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

async function hardRefresh() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) {
    // ignore
  }
  window.location.reload();
}

export default function App() {
  const [tab, setTab] = useState("inicio"); // inicio | publicaciones | beneficios | agenda | comunicacion | ajustes

  const [posts, setPosts] = useState([]);
  const [postsPager, setPostsPager] = useState({ page: 1, per_page: 6, limit_total: 100, has_more: false });
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [errorPosts, setErrorPosts] = useState("");

  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState("todas"); // todas | beneficios | eventos
  const categoryParam = categorySlug === "todas" ? "" : categorySlug;

  const [categories, setCategories] = useState([]);
  const [apiStatus, setApiStatus] = useState({ ok: false });

  // Agenda
  const [events, setEvents] = useState([]);
  const [eventsMeta, setEventsMeta] = useState({ updatedAt: null, count: 0 });
  const [todayEventsCount, setTodayEventsCount] = useState(0);
  const [badgeCount, setBadgeCount] = useState(0);
  const [agendaBase, setAgendaBase] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(null);
  // Admin token: se considera "admin" SOLO si el token está guardado (persistido) en el dispositivo.
  // Evita el bug donde al escribir la primera letra en "Clave admin" cambia de panel automáticamente.
  const [adminToken, setAdminToken] = useState(() => (localStorage.getItem("uic_admin_token") || "").trim());
  const [adminDraft, setAdminDraft] = useState(() => (localStorage.getItem("uic_admin_token") || "").trim());
  useEffect(() => {
    setAdminDraft(adminToken);
  }, [adminToken]);

  const isAdmin = Boolean(adminToken);

  // Comunicación al socio
  const [comms, setComms] = useState([]);
  const [commsMeta, setCommsMeta] = useState({ updatedAt: null, count: 0 });
  const [commsUnseen, setCommsUnseen] = useState(0);
  const [commsComposeOpen, setCommsComposeOpen] = useState(false);

  const canUseApi = useMemo(() => Boolean(API_BASE), []);

  useEffect(() => {
    (async () => {
      try {
        const h = await apiGet("/health");
        setApiStatus(h);
      } catch {
        setApiStatus({ ok: false });
      }
    })();
  }, []);

  async function loadCategories() {
    try {
      const data = await apiGet("/wp/categories");
      setCategories(data.items || []);
    } catch {
      // no crítico
      setCategories([]);
    }
  }

  async function loadPosts(opts = {}) {
    const { perPage = 6, page = 1, limitTotal = 100, category = categoryParam, q = search, append = false } = opts;

    if (!canUseApi) {
      setErrorPosts("Falta configurar VITE_API_BASE en el frontend.");
      return;
    }

    setLoadingPosts(true);
    setErrorPosts("");
    try {
      const qs = new URLSearchParams();
      qs.set("per_page", String(perPage));
      qs.set("page", String(page));
      qs.set("limit_total", String(limitTotal));
      if (q) qs.set("search", q);
      if (category) qs.set("category", category);

      const data = await apiGet(`/wp/posts?${qs.toString()}`);
      const items = (data.items || []).map(normalizePost);
      setPosts((prev) => {
        if (!append) return items;
        const seen = new Set((prev || []).map((x) => x.id));
        const merged = [...(prev || [])];
        for (const it of items) { if (!seen.has(it.id)) merged.push(it); }
        return merged;
      });
      setPostsPager({
        page: data.page || page,
        per_page: data.per_page || perPage,
        limit_total: data.limit_total || limitTotal,
        has_more: Boolean(data.has_more),
        next_page: data.next_page || null,
      });
    } catch (e) {
      setPosts([]);
      setErrorPosts(`No se pudo cargar publicaciones. Revisá conexión / WP (feed).`);
      console.error(e);
    } finally {
      setLoadingPosts(false);
    }
  }

  useEffect(() => {
    loadCategories();
    loadPosts({ perPage: 6, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canUseApi) return;
    loadComms(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUseApi]);

  // Re-carga cuando cambia filtro en Publicaciones o Inicio
  useEffect(() => {
    if (tab !== "publicaciones" && tab !== "inicio") return;
    loadPosts({ perPage: 6, page: 1, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, categorySlug]);

  useEffect(() => {
    if (tab !== "agenda") return;
    loadAgendaForTwoMonths(agendaBase);
    loadComms(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "comunicacion") return;
    loadComms(10);
    if (commsMeta?.updatedAt) markCommsSeen(commsMeta.updatedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);


  const quickLinks = [
    { label: "Hacete socio", href: "https://uic-campana.com.ar/hacete-socio/" },
    { label: "Promoción Industrial", href: "https://uic-campana.com.ar/category/promocion-industrial/" },
    { label: "Beneficios", href: "#", onClick: () => setTab("beneficios") },
    { label: "Agenda", href: "#", onClick: () => setTab("agenda") },
    { label: "Comunicación al socio", href: "#", onClick: () => { setTab("comunicacion"); } },
    { label: "Sitio UIC", href: "https://uic-campana.com.ar" },
  ];

  const homeCards = posts.slice(0, 6);

  // ---------------- Agenda helpers ----------------

function pad2(n) { return String(n).padStart(2, "0"); }

function localIsoDate(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return String(isoStr);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function startOfMonth(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), 1);
}

function addMonths(d, n) {
  const x = startOfMonth(d);
  return new Date(x.getFullYear(), x.getMonth() + n, 1);
}

function endOfMonth(d) {
  const x = startOfMonth(d);
  return new Date(x.getFullYear(), x.getMonth() + 1, 0);
}

function agendaMinBase() {
  return startOfMonth(new Date()); // mes actual
}

function agendaMaxBase() {
  // como se muestran 2 meses, el "base" máximo es mes actual + 10 (base+1 = +11 => 12 meses)
  return addMonths(new Date(), 10);
}

async function loadAgendaForTwoMonths(baseDate) {
  if (!canUseApi) return;
  const base = startOfMonth(baseDate);
  const min = agendaMinBase();
  const max = agendaMaxBase();
  const clamped = base < min ? min : base > max ? max : base;

  setAgendaBase(clamped);

  const from = localIsoDate(clamped);
  const to = localIsoDate(endOfMonth(addMonths(clamped, 1)));

  try {
    const meta = await apiGet("/events/meta");
    setEventsMeta(meta || { updatedAt: null, count: 0 });
  } catch {
    // no crítico
  }

  const data = await apiGet(`/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const items = data.items || [];
  setEvents(items);
  setEventsMeta((m) => ({ ...m, updatedAt: data.updatedAt || m.updatedAt }));

  const today = localIsoDate(new Date());
  setTodayEventsCount(items.filter((ev) => ev.date === today).length);
}

async function createEvent(payload) {
  if (!isAdmin) return;
  if (!canUseApi) return;

  const r = await fetch(`${API_BASE}/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);

  setEventsMeta((m) => ({ ...m, updatedAt: data.updatedAt || m.updatedAt }));
  await loadAgendaForTwoMonths(agendaBase);
}

  const iso = (d) => localIsoDate(d);

  function getEventsForDate(dateStr) {
    return (events || []).filter((e) => e.date === dateStr);
  }

  function renderMonth(year, monthIndex) {
    const first = new Date(year, monthIndex, 1);
    const last = new Date(year, monthIndex + 1, 0);
    const startDow = (first.getDay() + 6) % 7; // lunes=0
    const days = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, monthIndex, d));
    while (days.length % 7 !== 0) days.push(null);

    const monthName = first.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    return (
      <div className="calMonth" key={`${year}-${monthIndex}`}>
        <div className="calHeader">{monthName}</div>
        <div className="calGrid calWeekdays">
          {[
            "L",
            "M",
            "X",
            "J",
            "V",
            "S",
            "D",
          ].map((w) => (
            <div key={w} className="calCell calWeekday">
              {w}
            </div>
          ))}
        </div>
        <div className="calGrid">
          {days.map((dt, idx) => {
            if (!dt) return <div key={idx} className="calCell calEmpty" />;
            const dIso = iso(dt);
            const dayEvents = getEventsForDate(dIso);
            const has = dayEvents.length > 0;
            const hasHigh = dayEvents.some((e) => e.highlight);
            const isSel = selectedDate === dIso;
            return (
              <button
                key={idx}
                className={`calCell calDay ${has ? "calHas" : ""} ${hasHigh ? "calHigh" : ""} ${isSel ? "calSel" : ""}`}
                onClick={() => setSelectedDate(dIso)}
                title={has ? "Hay evento(s)" : ""}
              >
                <span className="calNum">{dt.getDate()}</span>
                {/* v0.11: sin puntito, se pinta la celda */}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function EventCreateForm({ date, onCreate }) {
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [highlight, setHighlight] = useState(true);
    const [saving, setSaving] = useState(false);

    async function submit() {
      try {
        setSaving(true);
        await onCreate({ date, title, description, highlight });
        setTitle("");
        setDescription("");
        alert("Evento creado.");
      } catch (e) {
        alert(e?.message || "No se pudo crear el evento");
      } finally {
        setSaving(false);
      }
    }

    return (
      <div className="eventForm">
        <input className="input" placeholder="Título (ej: Reunión de socios)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className="textarea"
          placeholder="Descripción / temario"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />
          <span>Resaltar (marca roja)</span>
        </label>
        <button className="btnPrimary" disabled={saving || !title.trim()} onClick={submit}>
          {saving ? "Guardando…" : "Crear evento"}
        </button>
        <button
          className="btnSecondary"
          onClick={() => {
            localStorage.removeItem("uic_admin_token");
            setAdminToken("");
            alert("Token eliminado en este dispositivo.");
          }}
        >
          Salir admin
        </button>
      </div>
    );
  }

  function CommCreateForm({ onPublish }) {
    const [title, setTitle] = useState("");
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);

    async function submit() {
      try {
        setSaving(true);
        const safeTitle = (title || "").toString().trim() || "Comunicado";
        await onPublish({ title: safeTitle, message });
        setTitle("");
        setMessage("");
        alert("Comunicación publicada.");
      } catch (e) {
        alert(e?.message || "No se pudo publicar");
      } finally {
        setSaving(false);
      }
    }

    return (
      <div className="eventForm" style={{ marginTop: 10 }}>
        <input className="input" placeholder="Título (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className="textarea"
          placeholder="Mensaje para el socio"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
        />
        <button className="btnPrimary" disabled={saving || !message.trim()} onClick={submit}>
          {saving ? "Publicando…" : "Publicar"}
        </button>
      </div>
    );
  }

  async function loadComms(limit = 10) {
    if (!canUseApi) return;
    try {
      const qs = new URLSearchParams();
      qs.set("limit", String(limit));
      const data = await apiGet(`/comms?${qs.toString()}`);
      setComms(data.items || []);
      if (data.updatedAt) {
        setCommsMeta((m) => ({ ...m, updatedAt: data.updatedAt }));
        const lastSeen = localStorage.getItem("uic_comms_seen_at") || "";
        if ((data.items || []).length > 0 && data.updatedAt !== lastSeen) setCommsUnseen(1);
        if ((data.items || []).length === 0) setCommsUnseen(0);
      }
    } catch {
      // ignorar
    }
  }

  async function publishComm({ title, message }) {
    if (!canUseApi) return;
    const r = await fetch(`${API_BASE}/comms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify({ title, message }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || `Error ${r.status}`);
    }
    const j = await r.json();
    setCommsMeta((m) => ({ ...m, updatedAt: j.updatedAt || m.updatedAt }));
    await loadComms(10);
    setCommsUnseen(0);
    if (j.updatedAt) markCommsSeen(j.updatedAt);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brandLogo" src={logoUIC} alt="UIC Campana" />
        </div>

        <div className="topActions">
          {/* reservado */}
        </div>
      </header>

      {!!errorPosts && (
        <div className="toast">
          <div className="toastText">{errorPosts}</div>
          <button className="linkBtn" onClick={() => setErrorPosts("")}>Cerrar</button>
        </div>
      )}

      <main className="content">
        {tab === "inicio" && (
          <>
            <section className="card">
              <div className="cardTitle">Accesos rápidos</div>
              <div className="quickGrid">
                {quickLinks.map((x) => (
                  <a
                    key={x.label}
                    className="quickTile"
                    href={x.href}
                    onClick={(e) => {
                      if (x.onClick) {
                        e.preventDefault();
                        x.onClick();
                      }
                    }}
                    target={x.href.startsWith("http") ? "_blank" : undefined}
                    rel={x.href.startsWith("http") ? "noreferrer" : undefined}
                  >
                    {x.label}
                  </a>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="rowBetween">
                <div>
                  <div className="cardTitle">Últimas publicaciones</div>
                  <div className="cardSub">Lectura desde el feed público de WordPress</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {postsPager.has_more && (
                    <button
                      className="btnSecondary"
                      disabled={loadingPosts}
                      onClick={() => loadPosts({ perPage: postsPager.per_page || 6, page: (postsPager.page || 1) + 1, append: true, category: categoryParam, q: "" })}
                      title="Cargar más"
                    >
                      Más
                    </button>
                  )}
                </div>
              </div>

              <div className="filterRow">
                <button
                  className={cls("chip", categorySlug === "todas" && "chipActive")}
                  onClick={() => setCategorySlug("todas")}
                >
                  Todas
                </button>
                <button
                  className={cls("chip", categorySlug === "beneficios" && "chipActive")}
                  onClick={() => setCategorySlug("beneficios")}
                >
                  Beneficios
                </button>
                <button
                  className={cls("chip", categorySlug === "eventos" && "chipActive")}
                  onClick={() => setCategorySlug("eventos")}
                >
                  Eventos
                </button>

                <button className="btnGhost" onClick={() => setTab("publicaciones")}>
                  Ver todas
                </button>
              </div>

              <div className="muted" style={{ marginTop: 6 }}>
                Mostrando {posts.length} publicaciones
              </div>

              {loadingPosts ? (
                <div className="muted">Cargando…</div>
              ) : (
                <div className="cardsScroller"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (!el) return;
                    const nearEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 40;
                    if (!nearEnd) return;
                    if (loadingPosts) return;
                    if (!postsPager.has_more) return;
                    loadPosts({ perPage: postsPager.per_page || 6, page: (postsPager.page || 1) + 1, append: true, category: categoryParam, q: "" });
                  }}
                >
                  {posts.map((p) => (
                    <a key={p.id} className="postCard" href={p.link} target="_blank" rel="noreferrer">
                      {p.image ? <img className="postImg" src={p.image} alt="" /> : <div className="postImgPlaceholder" />}
                      <div className="postBody">
                        <div className="postTitle">{p.title || "Sin título"}</div>
                        <div className="postExcerpt">{p.excerpt}</div>
                      </div>
                    </a>
                  ))}
                  {posts.length === 0 && <div className="muted">No hay publicaciones disponibles.</div>}
                </div>
              )}
            </section>
          </>
        )}

        {tab === "publicaciones" && (
          <section className="card">
            <div className="rowBetween">
              <div className="cardTitle">Publicaciones</div>
            </div>

            <div className="searchRow">
              <input
                className="input"
                placeholder="Buscar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btnPrimary" onClick={() => loadPosts({ perPage: 6, page: 1, q: search })}>
                Buscar
              </button>
            </div>

            <div className="filterRow">
              <button className={cls("chip", categorySlug === "todas" && "chipActive")} onClick={() => setCategorySlug("todas")}>
                Todas
              </button>
              <button className={cls("chip", categorySlug === "beneficios" && "chipActive")} onClick={() => setCategorySlug("beneficios")}>
                Beneficios
              </button>
              <button className={cls("chip", categorySlug === "eventos" && "chipActive")} onClick={() => setCategorySlug("eventos")}>
                Eventos
              </button>
            </div>

            {loadingPosts ? (
              <div className="muted">Cargando…</div>
            ) : (
              <>
              <div className="pagerRow">
                <button
                  className="btnSecondary"
                  disabled={postsPager.page <= 1}
                  onClick={() => loadPosts({ perPage: postsPager.per_page, page: Math.max(1, postsPager.page - 1) })}
                >
                  ◀
                </button>
                <div className="pagerInfo">
                  Página {postsPager.page} de {Math.ceil((postsPager.limit_total || 100) / (postsPager.per_page || 6))}
                </div>
                <button
                  className="btnSecondary"
                  disabled={!postsPager.has_more}
                  onClick={() => loadPosts({ perPage: postsPager.per_page, page: postsPager.page + 1 })}
                >
                  ▶
                </button>
              </div>

              <div className="postsList">
                {posts.map((p) => (
                  <a key={p.id} className="postRow" href={p.link} target="_blank" rel="noreferrer">
                    <div className="postRowTitle">{p.title || "Sin título"}</div>
                    <div className="postRowExcerpt">{p.excerpt}</div>
                  </a>
                ))}
                {posts.length === 0 && <div className="muted">No hay publicaciones para mostrar.</div>}
              </div>
              </>
            )}
          </section>
        )}

        {tab === "beneficios" && (
          <section className="card">
            <div className="cardTitle">Beneficios</div>
            <div className="muted">
              En el MVP, “Beneficios” se muestra filtrando publicaciones por categoría “beneficios”.
            </div>
            <button className="btnPrimary" onClick={() => { setTab("publicaciones"); setCategorySlug("beneficios"); }}>
              Ver beneficios
            </button>
          </section>
        )}

        {tab === "agenda" && (
          <section className="card">
            <div className="rowBetween">
              <div className="cardTitle">Agenda</div>
            </div>

            {!canUseApi ? (
              <div className="muted">No hay conexión con el servidor de la app (API).</div>
            ) : (
              <>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Se muestran <b>dos meses</b>. Podés avanzar/retroceder de a 2 meses.
                  Ventana móvil: desde el <b>mes actual</b> hasta <b>12 meses hacia adelante</b> (lo anterior se borra automáticamente).
                </div>

                <div className="pagerRow" style={{ marginTop: 0 }}>
                  <button
                    className="btnSecondary"
                    onClick={() => {
                      const min = agendaMinBase();
                      const next = addMonths(agendaBase, -2);
                      if (next < min) return;
                      loadAgendaForTwoMonths(next);
                    }}
                  >
                    ◀◀
                  </button>
                  <div className="pagerInfo">
                    {(() => {
                      const d1 = agendaBase;
                      const d2 = addMonths(agendaBase, 1);
                      const a = d1.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
                      const b = d2.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
                      return `${a} – ${b}`;
                    })()}
                  </div>
                  <input
                    className="input"
                    type="month"
                    value={`${agendaBase.getFullYear()}-${String(agendaBase.getMonth() + 1).padStart(2, "0")}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const [yy, mm] = v.split("-").map((x) => parseInt(x, 10));
                      if (!yy || !mm) return;
                      const candidate = new Date(yy, mm - 1, 1);
                      const min = agendaMinBase();
                      const max = agendaMaxBase();
                      if (candidate < min || candidate > max) return;
                      loadAgendaForTwoMonths(candidate);
                    }}
                    title="Ir a mes"
                    style={{ width: 140 }}
                  />
                  <button
                    className="btnSecondary"
                    onClick={() => {
                      const max = agendaMaxBase();
                      const next = addMonths(agendaBase, 2);
                      if (next > max) return;
                      loadAgendaForTwoMonths(next);
                    }}
                  >
                    ▶▶
                  </button>
                </div>

                <div className="calWrap">
                  {(() => {
                    const base = agendaBase;
                    const y = base.getFullYear();
                    const m = base.getMonth();
                    return (
                      <>
                        {renderMonth(y, m)}
                        {(() => {
                          const d2 = addMonths(base, 1);
                          return renderMonth(d2.getFullYear(), d2.getMonth());
                        })()}
                      </>
                    );
                  })()}
                </div>
                {/* Comunicación al socio */}
                <div style={{ marginTop: 14 }}>
                  <button className="btnPrimary" onClick={() => setTab("comunicacion")}>
                    Comunicación al socio
                    {commsUnseen > 0 && <span className="navBadgeNum">{commsUnseen}</span>}
                  </button>
                </div>



                {selectedDate && (
                  <div className="cardSub" style={{ marginTop: 12 }}>
                    <div className="rowBetween" style={{ gap: 8, alignItems: "center" }}>
                      <div>
                        <b>{selectedDate}</b>
                        <div className="muted" style={{ fontSize: 12 }}>Eventos del día</div>
                      </div>
                      <button className="btnSecondary" onClick={() => setSelectedDate(null)}>
                        Cerrar
                      </button>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      {getEventsForDate(selectedDate).length === 0 ? (
                        <div className="muted">No hay eventos cargados para este día.</div>
                      ) : (
                        <div className="eventsList">
                          {getEventsForDate(selectedDate).map((ev) => (
                            <div key={ev.id} className={`eventItem ${ev.highlight ? "eventHighlight" : ""}`}>
                              <div className="eventTitle">{ev.title}</div>
                              {ev.description && <div className="eventDesc">{ev.description}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div className="muted" style={{ marginBottom: 6 }}>
                        Carga de eventos (administración)
                      </div>

                      {!isAdmin ? (
                        <div className="row" style={{ gap: 8 }}>
                          <input
                            className="input"
                            placeholder="Clave admin"
                            value={adminDraft}
                            onChange={(e) => setAdminDraft(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                          <button
                            className="btnSecondary"
                            onClick={() => {
                              const tok = (adminDraft || "").toString().trim();
                              if (!tok) return alert("Ingresá la clave admin.");
                              localStorage.setItem("uic_admin_token", tok);
                              setAdminToken(tok);
                              alert("Token guardado en este dispositivo.");
                            }}
                          >
                            Guardar
                          </button>
                        </div>
                      ) : (
                        <EventCreateForm date={selectedDate} onCreate={createEvent} />
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        

        {tab === "comunicacion" && (
          <section className="card">
            <div className="rowBetween">
              <div>
                <div className="cardTitle">Comunicación al socio</div>
                <div className="cardSub">Mensajes institucionales (tipo WhatsApp). Solo el administrador puede publicar.</div>
              </div>
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                {!isAdmin ? (
                  <>
                    <input
                      className="input"
                      placeholder="Clave admin"
                      value={adminDraft}
                      onChange={(e) => setAdminDraft(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      style={{ width: 160 }}
                    />
                    <button
                      className="btnSecondary"
                      onClick={() => {
                        const tok = (adminDraft || "").toString().trim();
                        if (!tok) return alert("Ingresá la clave admin.");
                        localStorage.setItem("uic_admin_token", tok);
                        setAdminToken(tok);
                        alert("Token guardado en este dispositivo.");
                      }}
                    >
                      Guardar
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btnSecondary" onClick={() => setCommsComposeOpen((v) => !v)}>
                      {commsComposeOpen ? "Cerrar editor" : "Publicar"}
                    </button>
                    <button
                      className="btnSecondary"
                      onClick={() => {
                        localStorage.removeItem("uic_admin_token");
                        setAdminToken("");
                        alert("Token eliminado en este dispositivo.");
                      }}
                    >
                      Salir admin
                    </button>
                  </>
                )}
              </div>
            </div>

            {isAdmin && commsComposeOpen && <CommCreateForm onPublish={publishComm} />}

            <div style={{ marginTop: 12 }}>
              {(comms || []).length === 0 ? (
                <div className="muted">No hay comunicaciones publicadas.</div>
              ) : (
                <div className="eventsList">
                  {comms.map((c) => (
                    <div key={c.id || c.createdAt || c.title} className="eventItem">
                      <div className="eventTitle">{c.title}</div>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{formatDateTime(c.createdAt)}</div>
                      <div className="eventDesc" style={{ whiteSpace: "pre-wrap" }}>{c.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "ajustes" && (
          <section className="card">
            <div className="cardTitle">Ajustes</div>
            <div className="muted">
              <div>API: {API_BASE || "(sin configurar)"}</div>
              <div>Estado API: {apiStatus?.ok ? "OK" : "NO OK"}</div>
              <div style={{ marginTop: 10 }}>
                <b>iPhone (PWA):</b> para “instalar” la app, abrí en Safari → Compartir → <i>Agregar a inicio</i>.
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btnPrimary" onClick={hardRefresh}>Forzar actualización</button>
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Si el celular no toma cambios, este botón intenta borrar cache y service worker y recargar.
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav className="bottomNav">
        <button className={cls("navBtn", tab === "inicio" && "navActive")} onClick={() => setTab("inicio")}>
          Inicio
        </button>
        <button className={cls("navBtn", tab === "publicaciones" && "navActive")} onClick={() => setTab("publicaciones")}>
          Publicaciones
        </button>
        <button className={cls("navBtn", tab === "beneficios" && "navActive")} onClick={() => setTab("beneficios")}>
          Beneficios
        </button>
        <button className={cls("navBtn", tab === "agenda" && "navActive")} onClick={() => setTab("agenda")}>
          Agenda {todayEventsCount > 0 && <span className="navBadgeNum">{todayEventsCount}</span>}
        </button>
        <button className={cls("navBtn", tab === "ajustes" && "navActive")} onClick={() => setTab("ajustes")}>
          Ajustes
        </button>
      </nav>
    </div>
  );
}
