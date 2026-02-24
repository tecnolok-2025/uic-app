import React, { useEffect, useMemo, useState } from "react";
import "./index.css";

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

export default function App() {
  const [tab, setTab] = useState("inicio"); // inicio | publicaciones | beneficios | agenda | ajustes

  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [errorPosts, setErrorPosts] = useState("");

  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState("todas"); // todas | beneficios | eventos
  const categoryParam = categorySlug === "todas" ? "" : categorySlug;

  const [categories, setCategories] = useState([]);
  const [apiStatus, setApiStatus] = useState({ ok: false });

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
    const { perPage = 10, category = categoryParam, q = search } = opts;

    if (!canUseApi) {
      setErrorPosts("Falta configurar VITE_API_BASE en el frontend.");
      return;
    }

    setLoadingPosts(true);
    setErrorPosts("");
    try {
      const qs = new URLSearchParams();
      qs.set("per_page", String(perPage));
      if (q) qs.set("search", q);
      if (category) qs.set("category", category);

      const data = await apiGet(`/wp/posts?${qs.toString()}`);
      const items = (data.items || []).map(normalizePost);
      setPosts(items);
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
    loadPosts({ perPage: 10 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-carga cuando cambia filtro o búsqueda en Publicaciones
  useEffect(() => {
    if (tab !== "publicaciones") return;
    loadPosts({ perPage: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, categorySlug]);

  const quickLinks = [
    { label: "Hacete socio", href: "https://uic-campana.com.ar/asociate/" },
    { label: "Promoción Industrial", href: "https://uic-campana.com.ar/promocion-industrial/" },
    { label: "Beneficios", href: "#", onClick: () => setTab("beneficios") },
    { label: "Sitio UIC", href: "https://uic-campana.com.ar" },
  ];

  const homeCards = posts.slice(0, 6);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">UIC</div>
          <div className="brandSub">Campana</div>
        </div>

        <div className="topActions">
          {/* MVP: Push deshabilitado (sin botón) */}
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
                <button className="btnPrimary" onClick={() => loadPosts({ perPage: 10 })}>
                  Actualizar
                </button>
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

              {loadingPosts ? (
                <div className="muted">Cargando…</div>
              ) : (
                <div className="cardsScroller">
                  {homeCards.map((p) => (
                    <a key={p.id} className="postCard" href={p.link} target="_blank" rel="noreferrer">
                      {p.image ? <img className="postImg" src={p.image} alt="" /> : <div className="postImgPlaceholder" />}
                      <div className="postBody">
                        <div className="postTitle">{p.title || "Sin título"}</div>
                        <div className="postExcerpt">{p.excerpt}</div>
                      </div>
                    </a>
                  ))}
                  {homeCards.length === 0 && <div className="muted">No hay publicaciones disponibles.</div>}
                </div>
              )}
            </section>
          </>
        )}

        {tab === "publicaciones" && (
          <section className="card">
            <div className="rowBetween">
              <div className="cardTitle">Publicaciones</div>
              <button className="btnPrimary" onClick={() => loadPosts({ perPage: 12 })}>
                Actualizar
              </button>
            </div>

            <div className="searchRow">
              <input
                className="input"
                placeholder="Buscar…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btnPrimary" onClick={() => loadPosts({ perPage: 12, q: search })}>
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
              <div className="postsList">
                {posts.map((p) => (
                  <a key={p.id} className="postRow" href={p.link} target="_blank" rel="noreferrer">
                    <div className="postRowTitle">{p.title || "Sin título"}</div>
                    <div className="postRowExcerpt">{p.excerpt}</div>
                  </a>
                ))}
                {posts.length === 0 && <div className="muted">No hay publicaciones para mostrar.</div>}
              </div>
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
            <div className="cardTitle">Agenda</div>
            <div className="muted">MVP placeholder. Próximo paso: eventos desde WP (categoría “eventos”) y/o Google Calendar embed.</div>
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
          Agenda
        </button>
        <button className={cls("navBtn", tab === "ajustes" && "navActive")} onClick={() => setTab("ajustes")}>
          Ajustes
        </button>
      </nav>
    </div>
  );
}
