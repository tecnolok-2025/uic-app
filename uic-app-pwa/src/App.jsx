import React, { useEffect, useMemo, useState } from "react";
import "./index.css";
import logoUIC from "./assets/logo-uic.jpeg";

// Versión visible (footer / ajustes)
const APP_VERSION = "UIC App v0.24";
const BUILD_STAMP = (typeof __UIC_BUILD_STAMP__ !== "undefined") ? __UIC_BUILD_STAMP__ : "";
const PWA_CACHE_ID = (typeof __UIC_CACHE_ID__ !== "undefined") ? __UIC_CACHE_ID__ : "";

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

async function trySetIconBadge(n) {
  try {
    if (typeof navigator?.setAppBadge === "function") {
      await navigator.setAppBadge(n);
    }
  } catch (_) {
    // ignore
  }
}

async function tryClearIconBadge() {
  try {
    if (typeof navigator?.clearAppBadge === "function") {
      await navigator.clearAppBadge();
      return;
    }
    if (typeof navigator?.setAppBadge === "function") {
      await navigator.setAppBadge(0);
    }
  } catch (_) {
    // ignore
  }
}

async function tryShowLocalNotification() {
  // Objetivo: que Android muestre badge por notificación no leída.
  // En iOS (PWA instalada) puede aparecer como notificación normal; el badge del icono
  // se intenta con setAppBadge/clearAppBadge.
  try {
    if (!("Notification" in window)) return;
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") return;

    // Preferimos notificación "de página" para que persista aunque el SW se reinicie.
    // eslint-disable-next-line no-new
    new Notification("UIC", { body: "Actualización disponible / restablecida.", tag: "uic-update" });

    // Si hay Service Worker listo, también disparar desde SW (mejor integración en Android).
    if ("serviceWorker" in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification("UIC", {
          body: "Actualización disponible / restablecida.",
          tag: "uic-update",
          renotify: true,
        });
      } catch (_) {}
    }
  } catch (_) {
    // ignore
  }
}

async function hardRefreshWithBadge() {
  // 1) Marcar intención de badge (se limpia en el *próximo* ingreso real a la app)
  // Nota: no lo limpiamos inmediatamente porque si no nunca llegás a verlo en el ícono.
  try {
    localStorage.setItem("uic_icon_badge_set_at", String(Date.now()));
    localStorage.setItem("uic_icon_badge_pending", "1");
  } catch (_) {}

  // 2) Restablecer (borrar SW + cache)
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

  // 3) Setear badge + notificación (idealmente deja el badge visible en el ícono)
  await trySetIconBadge(1);
  await tryShowLocalNotification();

  // 4) Recargar (con query versionada para cache-bust fuerte)
  try {
    const u = new URL(window.location.href);
    u.searchParams.set("v", "0.24");
    u.searchParams.set("ts", String(Date.now()));
    window.location.href = u.toString();
  } catch (_) {
    window.location.reload();
  }
}

export default function App() {
  const [tab, setTab] = useState("inicio"); // inicio | publicaciones | beneficios | agenda | comunicacion | ajustes

  const [posts, setPosts] = useState([]);
  const [postsPager, setPostsPager] = useState({ page: 1, per_page: 6, limit_total: 100, has_more: false });
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [errorPosts, setErrorPosts] = useState("");

  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
  const [agendaError, setAgendaError] = useState("");
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

  // Socios (directorio)
  const [socios, setSocios] = useState([]);
  const [sociosCategory, setSociosCategory] = useState("todos"); // todos | logistica | fabricacion | servicios
  const [sociosSearchDraft, setSociosSearchDraft] = useState("");
  const [sociosSearchQuery, setSociosSearchQuery] = useState("");
  const [sociosPager, setSociosPager] = useState({ page: 1, per_page: 25, has_more: false, next_page: null, total: 0 });
  const [sociosLoading, setSociosLoading] = useState(false);
  const [sociosError, setSociosError] = useState("");
  const [sociosFormOpen, setSociosFormOpen] = useState(false);
  const [sociosFormMode, setSociosFormMode] = useState("create"); // create | edit
  const [sociosEditing, setSociosEditing] = useState(null);

  // Grilla/tabla (admin) para correcciones masivas
  const [sociosGridOpen, setSociosGridOpen] = useState(false);
  const [sociosGridItems, setSociosGridItems] = useState([]);
  const [sociosCsvFile, setSociosCsvFile] = useState(null);
  const [sociosCsvBusy, setSociosCsvBusy] = useState(false);
  const [sociosGridLoading, setSociosGridLoading] = useState(false);
  const [sociosGridError, setSociosGridError] = useState("");
  const [sociosBulkOpen, setSociosBulkOpen] = useState(false);
  const [sociosBulkText, setSociosBulkText] = useState("");
  const [sociosBulkBusy, setSociosBulkBusy] = useState(false);
  const [sociosBulkMsg, setSociosBulkMsg] = useState("");


const [socioForm, setSocioForm] = useState({
  member_no: "",
  company_name: "",
  category: "fabricacion",
  expertise: "",
  website_url: "",
  social_url: "",
});
const [sociosSaving, setSociosSaving] = useState(false);
const [sociosFormError, setSociosFormError] = useState("");

useEffect(() => {
  if (!sociosFormOpen) return;
  setSociosFormError("");
  if (sociosFormMode === "edit" && sociosEditing) {
    setSocioForm({
      member_no: String(sociosEditing.member_no ?? ""),
      company_name: String(sociosEditing.company_name ?? ""),
      category: String(sociosEditing.category ?? "fabricacion"),
      expertise: String(sociosEditing.expertise ?? ""),
      website_url: String(sociosEditing.website_url ?? ""),
      social_url: String(sociosEditing.social_url ?? ""),
    });
  } else {
    setSocioForm({
      member_no: "",
      company_name: "",
      category: "fabricacion",
      expertise: "",
      website_url: "",
      social_url: "",
    });
  }
}, [sociosFormOpen, sociosFormMode, sociosEditing]);

  function markCommsSeen(updatedAt) {
    const v = (updatedAt || new Date().toISOString()).toString();
    try { localStorage.setItem("uic_comms_seen_at", v); } catch (_) {}
    setCommsUnseen(0);
  }

  const canUseApi = useMemo(() => Boolean(API_BASE), []);

  // --- Badge del icono (home screen) ---
  // Comportamiento esperado para prueba:
  // - Al presionar "Forzar actualización" se intenta poner badge=1.
  // - Luego, al volver a abrir la app (después de salir a Home y reingresar), se intenta limpiar.
  useEffect(() => {
    const maybeClear = async () => {
      let ts = 0;
      try {
        ts = parseInt(localStorage.getItem("uic_icon_badge_set_at") || "0", 10) || 0;
      } catch (_) {
        ts = 0;
      }
      if (!ts) return;
      let pending = "";
      let hiddenAt = 0;
      try {
        pending = localStorage.getItem("uic_icon_badge_pending") || "";
        hiddenAt = parseInt(localStorage.getItem("uic_icon_badge_hidden_at") || "0", 10) || 0;
      } catch (_) {
        pending = "";
        hiddenAt = 0;
      }

      // Solo limpiar cuando:
      // - hay flag pendiente
      // - el usuario efectivamente salió de la app (hidden) luego de setear el badge
      // - pasaron unos segundos desde que se seteó
      if (!pending) return;
      if (Date.now() - ts < 5000) return;
      if (!hiddenAt || hiddenAt < ts) return;

      await tryClearIconBadge();
      try {
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          const notis = await reg.getNotifications({ tag: "uic-update" });
          (notis || []).forEach((n) => n.close());
        }
      } catch (_) {}
      try {
        localStorage.removeItem("uic_icon_badge_set_at");
        localStorage.removeItem("uic_icon_badge_pending");
        localStorage.removeItem("uic_icon_badge_hidden_at");
      } catch (_) {}
    };

    // al montar
    maybeClear();

    // al volver a la app
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        try { localStorage.setItem("uic_icon_badge_hidden_at", String(Date.now())); } catch (_) {}
      }
      if (document.visibilityState === "visible") maybeClear();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const h = await apiGet("/version").catch(() => apiGet("/health"));
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
    const { perPage = 6, page = 1, limitTotal = 100, category = categoryParam, q = searchQuery, append = false } = opts;

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
      const raw = (data.items || []).map(normalizePost);
      const terms = (q || "").toString().trim().toLowerCase().split(/\s+/).filter(Boolean);
      const items = terms.length
        ? raw.filter((it) => {
            const hay = `${it.title || ""} ${it.excerpt || ""}`.toLowerCase();
            return terms.every((t) => hay.includes(t));
          })
        : raw;
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

  // Re-carga cuando cambia filtro o búsqueda (solo al confirmar búsqueda)
  useEffect(() => {
    if (tab === "inicio") {
      // En Inicio, siempre mostrar últimas publicaciones (sin búsqueda)
      loadPosts({ perPage: 6, page: 1, append: false, q: "" });
      return;
    }
    if (tab === "publicaciones") {
      loadPosts({ perPage: 6, page: 1, append: false, q: searchQuery });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, categorySlug, searchQuery]);

  useEffect(() => {
    if (tab !== "agenda") return;
    loadAgendaForTwoMonths(agendaBase);
    loadComms(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "comunicacion") return;
    loadComms(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "socios") return;
    setSociosFormOpen(false);
    loadSocios({ page: 1, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sociosCategory, sociosSearchQuery]);


  const quickLinks = [
    { label: "Hacete socio", href: "https://uic-campana.com.ar/hacete-socio/" },
    { label: "Promoción Industrial", href: "https://uic-campana.com.ar/category/promocion-industrial/" },
    { label: "Beneficios", href: "#", onClick: () => setTab("beneficios") },
    { label: "Agenda", href: "#", onClick: () => setTab("agenda") },
    { label: "Comunicación al socio", href: "#", onClick: () => { setTab("comunicacion"); } },
    { label: "Socios", href: "#", onClick: () => { setTab("socios"); } },
    { label: "Requerimientos Institucionales", href: "https://cpf-web.onrender.com/" },
    { label: "Próximamente", href: "#", disabled: true },
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

  try {
    const data = await apiGet(`/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const items = data.items || [];
    setEvents(items);
    setEventsMeta((m) => ({ ...m, updatedAt: data.updatedAt || m.updatedAt }));

    const today = localIsoDate(new Date());
    setTodayEventsCount(items.filter((ev) => ev.date === today).length);
  } catch (e) {
    setEvents([]);
    setTodayEventsCount(0);
    setAgendaError(String(e?.message || e));
  }
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

  function SocioForm({ mode, initial, onSave, onCancel, onDelete }) {
    const [memberNo, setMemberNo] = useState(initial?.member_no ? String(initial.member_no) : "");
    const [companyName, setCompanyName] = useState(initial?.company_name || "");
    const [category, setCategory] = useState(initial?.category || "servicios");
    const [expertise, setExpertise] = useState(initial?.expertise || "");
    const [websiteUrl, setWebsiteUrl] = useState(initial?.website_url || "");
    const [socialUrl, setSocialUrl] = useState(initial?.social_url || "");
    const [saving, setSaving] = useState(false);

    const isEdit = mode === "edit";

    async function submit(e) {
      e.preventDefault();
      const n = parseInt(memberNo, 10);
      if (!Number.isFinite(n) || n <= 0) {
        alert("Ingresá un número de socio válido.");
        return;
      }
      if (!String(companyName || "").trim()) {
        alert("Ingresá el nombre de la empresa/persona.");
        return;
      }
      setSaving(true);
      try {
        await onSave({
          memberNo: n,
          companyName: String(companyName).trim(),
          category,
          expertise: String(expertise || "").trim(),
          websiteUrl: String(websiteUrl || "").trim(),
          socialUrl: String(socialUrl || "").trim(),
        });
      } catch (e) {
        alert(e?.message || "No se pudo guardar");
      } finally {
        setSaving(false);
      }
    }

    return (
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{isEdit ? "Editar socio" : "Agregar socio"}</h3>
          <button className="btnGhost" onClick={onCancel} type="button">
            Cerrar
          </button>
        </div>

        <form onSubmit={submit} className="form" style={{ marginTop: 10 }}>
          <div className="formRow">
            <label>N° socio</label>
            <input className="input" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} inputMode="numeric" />
          </div>
          <div className="formRow">
            <label>Empresa / persona</label>
            <input className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="formRow">
            <label>Rubro</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="logistica">Logística</option>
              <option value="fabricacion">Fabricación</option>
              <option value="servicios">Servicios</option>
            </select>
          </div>
          <div className="formRow">
            <label>Especialidad (breve)</label>
            <input
              className="input"
              value={expertise}
              onChange={(e) => setExpertise(e.target.value)}
              placeholder="Ej: metalmecánica, logística, consultoría..."
            />
          </div>
          <div className="formRow">
            <label>Web (opcional)</label>
            <input className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="formRow">
            <label>Red social (opcional)</label>
            <input
              className="input"
              value={socialUrl}
              onChange={(e) => setSocialUrl(e.target.value)}
              placeholder="https://instagram.com/..."
            />
          </div>

          <div className="row" style={{ gap: 10, marginTop: 12 }}>
            <button className="btnPrimary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
            {isEdit && (
              <button
                type="button"
                className="btnDanger"
                disabled={saving}
                onClick={async () => {
                  if (!onDelete) return;
                  const ok = confirm("¿Eliminar este socio del directorio?");
                  if (!ok) return;
                  setSaving(true);
                  try {
                    await onDelete();
                  } catch (e) {
                    alert(e?.message || "No se pudo eliminar");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Eliminar
              </button>
            )}
          </div>
        </form>
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
        if ((data.items || []).length === 0) {
          setCommsUnseen(0);
        } else if (data.updatedAt && data.updatedAt !== lastSeen) {
          setCommsUnseen(1);
        } else {
          setCommsUnseen(0);
        }
        // Si el usuario está en la pestaña Comunicación, marcar como visto automáticamente
        if (tab === "comunicacion" && data.updatedAt) markCommsSeen(data.updatedAt);
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


  /* ----------------------------- Socios -------------------------------- */

  async function loadSocios(opts = {}) {
    const { page = 1, perPage = 25, append = false, category = sociosCategory, q = sociosSearchQuery } = opts;

    if (!canUseApi) {
      setSociosError("Falta configurar VITE_API_BASE en el frontend.");
      return;
    }

    setSociosLoading(true);
    setSociosError("");
    try {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("per_page", String(perPage));
      if (category && category !== "todos") qs.set("category", category);
      if (q) qs.set("q", q);

      const data = await apiGet(`/socios?${qs.toString()}`);
      const items = Array.isArray(data.items) ? data.items : [];

      setSocios((prev) => (append ? [...(prev || []), ...items] : items));
      setSociosPager({
        page: data.page || page,
        per_page: data.per_page || perPage,
        has_more: Boolean(data.has_more),
        next_page: data.next_page || null,
        total: Number.isFinite(data.total) ? data.total : items.length,
      });
    } catch (e) {
      if (!append) setSocios([]);
      setSociosError(String(e?.message || e));
    } finally {
      setSociosLoading(false);
    }
  }

  function openSocioForm(mode, socio = null) {
    setSociosFormMode(mode);
    setSociosEditing(socio);
    setSociosFormOpen(true);
  }

  async function saveSocio(payload) {
    if (!canUseApi) throw new Error("Falta configurar VITE_API_BASE en el frontend.");
    if (!isAdmin) throw new Error("Acceso denegado (clave admin).");

    const headers = {
      "Content-Type": "application/json",
      "x-admin-token": adminToken,
    };

    if (sociosFormMode === "edit" && sociosEditing?.id) {
      const r = await fetch(`${API_BASE}/socios/${encodeURIComponent(sociosEditing.id)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
      return { ok: true };
    }

    const r = await fetch(`${API_BASE}/socios`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
    return j;
  }

  async function deleteSocio(id) {
    if (!canUseApi) throw new Error("Falta configurar VITE_API_BASE en el frontend.");
    if (!isAdmin) throw new Error("Acceso denegado (clave admin).");
    const r = await fetch(`${API_BASE}/socios/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-admin-token": adminToken },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
    return j;
  }

  async function updateSocioInline(id, payload) {
    if (!canUseApi) throw new Error("Falta configurar VITE_API_BASE en el frontend.");
    if (!isAdmin) throw new Error("Acceso denegado (clave admin).");
    const r = await fetch(`${API_BASE}/socios/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
    return j;
  

  async function bulkUpsertSocios(items) {
    if (!canUseApi) throw new Error("Falta configurar VITE_API_BASE en el frontend.");
    if (!isAdmin) throw new Error("Acceso denegado (clave admin).");

    const r = await fetch(`${API_BASE}/socios/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": adminToken,
      },
      body: JSON.stringify({ items }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`);
    return j;
  }

  // CSV helpers (para editar planilla offline)
  function parseCsv(text) {
    const t = String(text || "").replace(/^\uFEFF/, ""); // strip BOM
    const lines = t.split(/\r?\n/).filter((l) => l.trim().length);
    if (!lines.length) return [];

    // Detect delimiter: Excel (ES) suele usar ';'
    const headerLine = lines[0];
    const commaCount = (headerLine.match(/,/g) || []).length;
    const semiCount = (headerLine.match(/;/g) || []).length;
    const delim = semiCount > commaCount ? ";" : ",";

    const parseLine = (line) => {
      const out = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              inQ = false;
            }
          } else {
            cur += ch;
          }
        } else {
          if (ch === '"') inQ = true;
          else if (ch === delim) {
            out.push(cur);
            cur = "";
          } else {
            cur += ch;
          }
        }
      }
      out.push(cur);
      return out.map((x) => String(x ?? "").trim());
    };

    const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
    const idx = (name) => headers.indexOf(String(name).toLowerCase());

    const iNo = idx("member_no");
    const iName = idx("company_name");
    const iCat = idx("category");
    const iExp = idx("expertise");
    const iWeb = idx("website_url");
    const iSoc = idx("social_url");

    const rows = [];
    const errors = [];
    for (let li = 1; li < lines.length; li++) {
      const cols = parseLine(lines[li]);
      const memberNo = parseInt(cols[iNo] || "", 10);
      const companyName = String(cols[iName] || "").trim();
      if (!Number.isFinite(memberNo) || memberNo <= 0 || !companyName) continue;
      const rawCat = String(cols[iCat] || "").trim();
      const cat = normalizeSocioCategory(rawCat);
      if (!cat) {
        errors.push(
          `Línea ${li + 1}: category inválida "${rawCat}" (usar SERVICIOS / FABRICACION / LOGISTICA)`
        );
      }
      rows.push({
        member_no: memberNo,
        company_name: companyName,
        category: cat || "fabricacion",
        expertise: String(cols[iExp] || "").trim(),
        website_url: normalizeUrl(cols[iWeb] || ""),
        social_url: normalizeUrl(cols[iSoc] || ""),
      });
    }
    return { rows, errors };
  }

  async function downloadSociosCsv() {
    if (!isAdmin) return alert("Acceso denegado (clave admin).");
    setSociosCsvBusy(true);
    try {
      const r = await fetch(`${API_BASE}/socios/export.csv`, {
        headers: { "x-admin-token": adminToken },
      });
      if (!r.ok) throw new Error(`Error export (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "uic_socios.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setSociosCsvBusy(false);
    }
  }

  async function uploadSociosCsv() {
    if (!isAdmin) return alert("Acceso denegado (clave admin).");
    if (!sociosCsvFile) return alert("Seleccioná un archivo CSV primero.");
    setSociosCsvBusy(true);
    try {
      const txt = await sociosCsvFile.text();
      const parsed = parseCsv(txt);
      const items = parsed?.rows || [];
      const errors = parsed?.errors || [];
      if (!items.length) throw new Error("No se encontraron filas válidas en el CSV.");
      if (errors.length) {
        const msg = errors.slice(0, 12).join("\n") + (errors.length > 12 ? `\n…y ${errors.length - 12} más.` : "");
        throw new Error(`Hay categorías inválidas en el CSV:\n${msg}`);
      }
      await bulkUpsertSocios(items);
      // refrescar vista socios (si el usuario ya estaba ahí)
      try {
        await loadSocios({ page: 1, append: false, category: sociosCategory, q: sociosSearchQuery });
      } catch (_) {}
      alert(`OK. Se importaron ${items.length} socios.`);
      setSociosCsvFile(null);
    } catch (e) {
      alert(String(e?.message || e));
    } finally {
      setSociosCsvBusy(false);
    }
  }
}

  async function openSociosGrid() {
    setSociosGridError("");
    setSociosGridOpen(true);
    setSociosGridLoading(true);
    try {
      // Traer todo (máximo 200) para edición masiva.
      const qs = new URLSearchParams();
      qs.set("page", "1");
      qs.set("per_page", "200");
      const data = await apiGet(`/socios?${qs.toString()}`);
      setSociosGridItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setSociosGridItems([]);
      setSociosGridError(String(e?.message || e));
    } finally {
      setSociosGridLoading(false);
    }
  }

function prettySocioCategory(cat) {
  const c = String(cat || "").toLowerCase();
  if (c === "logistica") return "Logística";
  if (c === "servicios") return "Servicios";
  return "Fabricación";
}

// Categorías permitidas para filtros y planilla
const SOCIO_CATEGORIES = ["fabricacion", "logistica", "servicios"];

function normalizeSocioCategory(raw) {
  // Tolerante a tildes, mayúsculas y errores comunes (ej: "loggistica").
  let s = String(raw || "").trim().toLowerCase();
  try {
    s = s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  } catch (_) {
    // navegadores viejos: continuar sin normalizar
  }
  s = s.replace(/\s+/g, " ");
  if (s === "loggistica") s = "logistica";
  if (s === "servicio") s = "servicios";
  if (s === "manufactura" || s === "manufacturacion" || s === "fabrica") s = "fabricacion";
  if (SOCIO_CATEGORIES.includes(s)) return s;
  return "";
}

function isValidSocioCategory(raw) {
  return SOCIO_CATEGORIES.includes(normalizeSocioCategory(raw));
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function normalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  return `https://${s}`;
}

function socioHref(s) {
  const w = normalizeUrl(s?.website_url);
  const so = normalizeUrl(s?.social_url);
  return w || so || "";
}

async function submitSocioForm() {
  try {
    setSociosFormError("");
    setSociosSaving(true);

    const memberNo = parseInt(String(socioForm.member_no || "").trim(), 10);
    if (!Number.isFinite(memberNo) || memberNo <= 0) throw new Error("Ingresá un Nº de socio válido.");
    const companyName = String(socioForm.company_name || "").trim();
    if (!companyName) throw new Error("Ingresá el nombre de la empresa.");

    const payload = {
      member_no: memberNo,
      company_name: companyName,
      category: String(socioForm.category || "fabricacion"),
      expertise: String(socioForm.expertise || "").trim(),
      website_url: normalizeUrl(socioForm.website_url),
      social_url: normalizeUrl(socioForm.social_url),
    };

    await saveSocio(payload);
    setSociosFormOpen(false);
    setSociosEditing(null);
    // recargar respetando filtros actuales
    await loadSocios({ page: 1, append: false, category: sociosCategory, q: sociosSearchQuery });
  } catch (e) {
    setSociosFormError(String(e?.message || e));
  } finally {
    setSociosSaving(false);
  }
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
                    className={cls("quickTile", x.disabled && "quickTileDisabled")}
                    href={x.href}
                    aria-disabled={x.disabled ? "true" : "false"}
                    onClick={(e) => {
                      if (x.disabled) {
                        e.preventDefault();
                        return;
                      }
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
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const q = (searchDraft || "").trim();
                    setSearchQuery(q);
                    loadPosts({ perPage: 6, page: 1, q });
                  }
                }}
              />
              <button
                className="btnPrimary"
                onClick={() => {
                  const q = (searchDraft || "").trim();
                  setSearchQuery(q);
                  loadPosts({ perPage: 6, page: 1, q });
                }}
              >
                Buscar
              </button>
              <button
                className="btnSecondary"
                onClick={() => {
                  setSearchDraft("");
                  setSearchQuery("");
                  loadPosts({ perPage: 6, page: 1, q: "" });
                }}
              >
                Limpiar
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

        
{tab === "socios" && (
  <main className="content">
    <section className="card">
      <div className="rowBetween">
        <div>
          <div className="cardTitle">Socios UIC</div>
          <div className="cardSub">
            Directorio de empresas socias. Se muestra solo Nº de socio y empresa. Tocá el nombre para abrir su web o red social (si está cargada).
          </div>
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btnSmall" onClick={() => openSocioForm("create")}>Nuevo socio</button>
            <button className="btnSmall" onClick={openSociosGrid}>Tabla / Grilla</button>
          </div>
        )}
      </div>

      <div className="filters">
        {[
          { key: "todos", label: "Todos" },
          { key: "logistica", label: "Logística" },
          { key: "fabricacion", label: "Fabricación" },
          { key: "servicios", label: "Servicios" },
        ].map((c) => (
          <button
            key={c.key}
            className={sociosCategory === c.key ? "pill pillActive" : "pill"}
            onClick={() => {
              setSociosCategory(c.key);
              loadSocios({ page: 1, append: false, category: c.key, q: sociosSearchQuery });
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="searchRow">
        <input
          className="input"
          placeholder="Buscar por empresa (ej: Tecno)"
          value={sociosSearchDraft}
          onChange={(e) => setSociosSearchDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const q = sociosSearchDraft.trim();
              setSociosSearchQuery(q);
              loadSocios({ page: 1, append: false, category: sociosCategory, q });
            }
          }}
        />
        <button
          className="btnPrimary"
          onClick={() => {
            const q = sociosSearchDraft.trim();
            setSociosSearchQuery(q);
            loadSocios({ page: 1, append: false, category: sociosCategory, q });
          }}
        >
          Buscar
        </button>
        {sociosSearchQuery ? (
          <button
            className="btnGhost"
            onClick={() => {
              setSociosSearchDraft("");
              setSociosSearchQuery("");
              loadSocios({ page: 1, append: false, category: sociosCategory, q: "" });
            }}
          >
            Limpiar
          </button>
        ) : null}
      </div>

      {sociosError ? <div className="muted">Error: {sociosError}</div> : null}
      {sociosLoading ? <div className="muted">Cargando socios…</div> : null}

      {!sociosLoading && !sociosError ? (
        <div className="sociosList">
          {socios.length === 0 ? (
            <div className="muted">No hay socios para mostrar con esos filtros.</div>
          ) : (
            socios.map((s) => {
              const href = socioHref(s);
              return (
                <div className="socioRow" key={s.id}>
                  <div className="socioMain">
                    <div className="socioTop">
                      <span className="socioNo">{s.member_no}</span>
                      {href ? (
                        <a className="socioLink" href={href} target="_blank" rel="noreferrer">
                          {s.company_name}
                        </a>
                      ) : (
                        <span className="socioLinkDisabled">{s.company_name}</span>
                      )}
                    </div>
                    <div className="socioMeta">
                      {prettySocioCategory(s.category)}
                      {s.expertise ? ` • ${s.expertise}` : ""}
                      {!href ? " • (sin web/red cargada)" : ""}
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="socioActions">
                      <button className="btnSmall" onClick={() => openSocioForm("edit", s)}>Editar</button>
                      <button
                        className="btnDanger"
                        onClick={async () => {
                          const ok = window.confirm(`¿Eliminar al socio ${s.member_no} – ${s.company_name}?`);
                          if (!ok) return;
                          await deleteSocio(s.id);
                          await loadSocios({ page: 1, append: false, category: sociosCategory, q: sociosSearchQuery });
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {!sociosLoading && sociosPager?.has_more ? (
        <div style={{ marginTop: 10 }}>
          <button
            className="btnGhost"
            onClick={() =>
              loadSocios({
                page: sociosPager.next_page || sociosPager.page + 1,
                perPage: sociosPager.per_page,
                append: true,
                category: sociosCategory,
                q: sociosSearchQuery,
              })
            }
          >
            Cargar más
          </button>
        </div>
      ) : null}

      {sociosFormOpen ? (
        <div className="modalOverlay" onClick={() => setSociosFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">{sociosFormMode === "edit" ? "Editar socio" : "Nuevo socio"}</div>
            <div className="modalSub">Solo se publican Nº de socio y Empresa. Web/Red social son enlaces.</div>

            {sociosFormError ? <div className="muted">⚠ {sociosFormError}</div> : null}

            <div className="formGrid">
              <label className="formLabel">
                Nº de socio
                <input
                  className="input"
                  value={socioForm.member_no}
                  onChange={(e) => setSocioForm((p) => ({ ...p, member_no: e.target.value }))}
                  placeholder="Ej: 101"
                  disabled={sociosFormMode === "edit"}
                />
              </label>

              <label className="formLabel">
                Empresa
                <input
                  className="input"
                  value={socioForm.company_name}
                  onChange={(e) => setSocioForm((p) => ({ ...p, company_name: e.target.value }))}
                  placeholder="Razón social"
                />
              </label>

              <label className="formLabel">
                Clasificación
                <select
                  className="input"
                  value={socioForm.category}
                  onChange={(e) => setSocioForm((p) => ({ ...p, category: e.target.value }))}
                >
                  <option value="fabricacion">Fabricación</option>
                  <option value="logistica">Logística</option>
                  <option value="servicios">Servicios</option>
                </select>
              </label>

              <label className="formLabel">
                Expertise (corto)
                <input
                  className="input"
                  value={socioForm.expertise}
                  onChange={(e) => setSocioForm((p) => ({ ...p, expertise: e.target.value }))}
                  placeholder="Ej: automatización industrial"
                />
              </label>

              <label className="formLabel">
                Web (URL)
                <input
                  className="input"
                  value={socioForm.website_url}
                  onChange={(e) => setSocioForm((p) => ({ ...p, website_url: e.target.value }))}
                  placeholder="https://..."
                />
              </label>

              <label className="formLabel">
                Red social (URL)
                <input
                  className="input"
                  value={socioForm.social_url}
                  onChange={(e) => setSocioForm((p) => ({ ...p, social_url: e.target.value }))}
                  placeholder="https://instagram.com/..."
                />
              </label>
            </div>

            <div className="rowEnd">
              <button className="btnGhost" onClick={() => setSociosFormOpen(false)} disabled={sociosSaving}>
                Cancelar
              </button>
              <button className="btnPrimary" onClick={submitSocioForm} disabled={sociosSaving}>
                {sociosSaving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sociosGridOpen ? (
        <div className="modalOverlay" onClick={() => setSociosGridOpen(false)}>
          <div className="modal modalWide" onClick={(e) => e.stopPropagation()}>
            <div className="modalTitle">Tabla / Grilla de Socios (Admin)</div>
            <div className="modalSub">
              Edición masiva de categoría, expertise y links. (Se publican solo Nº de socio + Empresa, pero los links se usan para abrir web/red.)
            </div>


            <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <button
                className="btnSmall"
                onClick={() => {
                  try {
                    const exportItems = (sociosGridItems || []).map((s) => ({
                      member_no: Number(s.member_no),
                      company_name: String(s.company_name || "").trim(),
                      category: String(s.category || "fabricacion"),
                      expertise: String(s.expertise || "").trim(),
                      website_url: String(s.website_url || "").trim(),
                      social_url: String(s.social_url || "").trim(),
                    }));
                    downloadJson("uic_socios_export.json", exportItems);
                  } catch (e) {
                    alert(String(e?.message || e));
                  }
                }}
              >
                Exportar JSON
              </button>

              <button
                className="btnSmall"
                onClick={() => {
                  setSociosBulkOpen((p) => !p);
                  setSociosBulkMsg("");
                }}
              >
                {sociosBulkOpen ? "Cerrar importación" : "Importar JSON"}
              </button>

              {sociosBulkMsg ? <span className="muted">{sociosBulkMsg}</span> : null}
            </div>

            {sociosBulkOpen ? (
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Pegá acá un JSON (array) con campos: member_no, company_name, category, expertise, website_url, social_url. Se hace <b>upsert</b> por Nº de socio.
                </div>
                <textarea
                  className="input"
                  style={{ width: "100%", minHeight: 160, fontFamily: "monospace", fontSize: 12 }}
                  value={sociosBulkText}
                  onChange={(e) => setSociosBulkText(e.target.value)}
                  placeholder='[ { "member_no": 101, "company_name": "...", "category": "servicios", "expertise": "...", "website_url": "https://..." } ]'
                />
                <div className="rowEnd" style={{ marginTop: 8 }}>
                  <button
                    className="btnGhost"
                    onClick={() => {
                      setSociosBulkText("");
                      setSociosBulkMsg("");
                    }}
                    disabled={sociosBulkBusy}
                  >
                    Limpiar
                  </button>
                  <button
                    className="btnPrimary"
                    disabled={sociosBulkBusy}
                    onClick={async () => {
                      try {
                        setSociosBulkBusy(true);
                        setSociosBulkMsg("");
                        const parsed = JSON.parse(String(sociosBulkText || "[]"));
                        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("JSON inválido o vacío.");

                        const items = parsed.map((x) => ({
                          member_no: Number(x.member_no ?? x.memberNo),
                          company_name: String(x.company_name ?? x.companyName ?? "").trim(),
                          category: String(x.category || "").trim().toLowerCase(),
                          expertise: String(x.expertise || "").trim(),
                          website_url: String(x.website_url ?? x.websiteUrl ?? "").trim(),
                          social_url: String(x.social_url ?? x.socialUrl ?? "").trim(),
                        }));

                        await bulkUpsertSocios(items);
                        setSociosBulkMsg(`Importación OK (${items.length})`);
                        await openSociosGrid();
                        await loadSocios({ page: 1, append: false, category: sociosCategory, q: sociosSearchQuery });
                      } catch (e) {
                        setSociosBulkMsg(`Error: ${String(e?.message || e)}`);
                      } finally {
                        setSociosBulkBusy(false);
                      }
                    }}
                  >
                    {sociosBulkBusy ? "Importando…" : "Aplicar importación"}
                  </button>
                </div>
              </div>
            ) : null}

            {sociosGridError ? <div className="muted">⚠ {sociosGridError}</div> : null}
            {sociosGridLoading ? <div className="muted">Cargando…</div> : null}

            {!sociosGridLoading ? (
              <div style={{ overflowX: "auto" }}>
                <table className="gridTable">
                  <thead>
                    <tr>
                      <th>Nº</th>
                      <th>Empresa</th>
                      <th>Categoría</th>
                      <th>Expertise</th>
                      <th>Web</th>
                      <th>Red</th>
                      <th>Guardar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sociosGridItems.map((s) => (
                      <tr key={s.id}>
                        <td style={{ whiteSpace: "nowrap" }}><b>{s.member_no}</b></td>
                        <td style={{ minWidth: 220 }}>{s.company_name}</td>
                        <td>
                          {(() => {
                            const catOk = isValidSocioCategory(s.category);
                            const current = normalizeSocioCategory(s.category) || "";
                            return (
                              <select
                                className={`input ${catOk ? "" : "inputError"}`}
                                title={catOk ? "" : "Categoría inválida. Usar: Fabricación / Logística / Servicios"}
                                value={current}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSociosGridItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, category: v } : x)));
                                }}
                              >
                                {!catOk ? <option value="">⚠ inválida</option> : null}
                                <option value="fabricacion">Fabricación</option>
                                <option value="logistica">Logística</option>
                                <option value="servicios">Servicios</option>
                              </select>
                            );
                          })()}
                        </td>
                        <td>
                          <input
                            className="input"
                            value={s.expertise || ""}
                            placeholder="(corto)"
                            onChange={(e) => {
                              const v = e.target.value;
                              setSociosGridItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, expertise: v } : x)));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            value={s.website_url || ""}
                            placeholder="https://..."
                            onChange={(e) => {
                              const v = e.target.value;
                              setSociosGridItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, website_url: v } : x)));
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            value={s.social_url || ""}
                            placeholder="https://..."
                            onChange={(e) => {
                              const v = e.target.value;
                              setSociosGridItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, social_url: v } : x)));
                            }}
                          />
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button
                            className={`btnSmall ${isValidSocioCategory(s.category) ? "" : "btnDisabled"}`}
                            disabled={!isValidSocioCategory(s.category)}
                            title={isValidSocioCategory(s.category) ? "" : "Corregí la categoría antes de guardar"}
                            onClick={async () => {
                              try {
                                const cat = normalizeSocioCategory(s.category);
                                if (!cat) {
                                  alert("Categoría inválida. Usar: Fabricación / Logística / Servicios");
                                  return;
                                }
                                const payload = {
                                  category: cat,
                                  expertise: String(s.expertise || "").trim(),
                                  website_url: normalizeUrl(s.website_url),
                                  social_url: normalizeUrl(s.social_url),
                                };
                                await updateSocioInline(s.id, payload);
                                // refrescar lista principal (respetando filtros actuales)
                                await loadSocios({ page: 1, append: false, category: sociosCategory, q: sociosSearchQuery });
                              } catch (e) {
                                alert(String(e?.message || e));
                              }
                            }}
                          >
                            Guardar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="rowEnd" style={{ marginTop: 10 }}>
              <button className="btnGhost" onClick={() => setSociosGridOpen(false)}>Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  </main>
)}
{tab === "ajustes" && (
          <section className="card">
            <div className="cardTitle">Ajustes</div>
            <div className="muted">
              <div>Versión: {APP_VERSION}</div>
              <div>Build: {BUILD_STAMP || "(sin build stamp)"}</div>
              <div>CacheId: {PWA_CACHE_ID || "(s/d)"}</div>
              <div>URL: {window.location.origin}</div>
              <div>API: {API_BASE || "(sin configurar)"}</div>
              <div>Estado API: {apiStatus?.ok ? "OK" : "NO OK"}</div>
              <div>API versión: {apiStatus?.apiVersion || "(s/d)"}</div>
              <div>API build: {apiStatus?.build || "(s/d)"}</div>
              <div style={{ marginTop: 10 }}>
                <b>iPhone (PWA):</b> para “instalar” la app, abrí en Safari → Compartir → <i>Agregar a inicio</i>.
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="btnPrimary" onClick={hardRefreshWithBadge}>Forzar actualización</button>
                <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Si el celular no toma cambios, este botón intenta borrar cache y service worker y recargar.
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Administrador</div>

                {!isAdmin ? (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input
                      className="input"
                      placeholder="Clave admin"
                      value={adminDraft}
                      onChange={(e) => setAdminDraft(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      style={{ maxWidth: 220 }}
                    />
                    <button
                      className="btnSecondary"
                      onClick={() => {
                        const tok = (adminDraft || "").toString().trim();
                        if (!tok) return alert("Ingresá la clave admin.");
                        localStorage.setItem("uic_admin_token", tok);
                        setAdminToken(tok);
                        alert("Admin ACTIVO en este dispositivo.");
                      }}
                    >
                      Guardar clave
                    </button>
                  </div>
                ) : (
                  <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="pill pillActive">Admin: ACTIVO</span>
                    <button
                      className="btnSecondary"
                      onClick={() => {
                        localStorage.removeItem("uic_admin_token");
                        setAdminToken("");
                        alert("Admin desactivado en este dispositivo.");
                      }}
                    >
                      Salir admin
                    </button>
                  </div>
                )}

                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  La clave admin se guarda solo en este dispositivo. No se comparte con otros socios.
                </div>
              </div>

              {isAdmin && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Socios (planilla)</div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    Descargá la planilla (CSV), editá en Excel/Sheets y subila para actualizar la base.
                  </div>

                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <button className="btnGhost" disabled={sociosCsvBusy} onClick={downloadSociosCsv}>
                      {sociosCsvBusy ? "Procesando..." : "Descargar planilla (CSV)"}
                    </button>

                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(e) => setSociosCsvFile(e.target.files?.[0] || null)}
                      style={{ maxWidth: 260 }}
                    />

                    <button className="btnPrimary" disabled={sociosCsvBusy || !sociosCsvFile} onClick={uploadSociosCsv}>
                      Subir planilla (CSV)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      <div className="appFooter">{APP_VERSION}</div>

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
