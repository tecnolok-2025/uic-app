import React, { useEffect, useMemo, useState } from "react";
import { fetchCategories, fetchPosts, pickFeaturedImage } from "./api/wp.js";
import { enablePush } from "./api/push.js";
import { getApiBase, setApiBase, getWpBase, setWpBase, isStandalone } from "./config.js";

const TABS = [
  { key: "inicio", label: "Inicio" },
  { key: "posts", label: "Publicaciones" },
  { key: "beneficios", label: "Beneficios" },
  { key: "agenda", label: "Agenda" },
  { key: "ajustes", label: "Ajustes" },
];

const LS_LAST_SEEN = "UIC_LAST_SEEN_POST_ID";

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}

function getLastSeen() {
  const v = Number(localStorage.getItem(LS_LAST_SEEN) || "0");
  return Number.isFinite(v) ? v : 0;
}
function setLastSeen(id) {
  if (!id) return;
  localStorage.setItem(LS_LAST_SEEN, String(id));
}

export default function App() {
  const [tab, setTab] = useState("inicio");
  const [cats, setCats] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);

  const [errPush, setErrPush] = useState("");
  const [errPosts, setErrPosts] = useState("");

  const [apiBase, setApiBaseState] = useState(getApiBase());
  const [wpBase, setWpBaseState] = useState(getWpBase());

  const newestPostId = useMemo(() => {
    const ids = posts.map(p => Number(p.id || 0)).filter(Boolean);
    return ids.length ? Math.max(...ids) : 0;
  }, [posts]);

  const unreadCount = useMemo(() => {
    const lastSeen = getLastSeen();
    return posts.filter(p => Number(p.id || 0) > lastSeen).length;
  }, [posts]);

  const catIdBeneficios = useMemo(() => {
    const found = cats.find(c => (c.slug || "").includes("benef"));
    return found?.id || "";
  }, [cats]);

  async function loadCategories() {
    try {
      const c = await fetchCategories();
      setCats(c);
    } catch (e) {
      console.error(e);
    }
  }

  async function loadPosts(opts = {}) {
    setLoading(true);
    setErrPosts("");
    try {
      const data = await fetchPosts({
        page: 1,
        perPage: 10,
        search: opts.search ?? search,
        categoryId: opts.categoryId ?? "",
      });
      setPosts(Array.isArray(data) ? data : []);
      // If user is on posts tab, we consider latest as "seen"
      if (tab === "posts") setLastSeen(newestPostId || (data?.[0]?.id ?? 0));
    } catch (e) {
      console.error(e);
      setErrPosts("No se pudo cargar publicaciones. Revisá conexión / WP API.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
    // Load initial feed for Home
    loadPosts({ categoryId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "posts") {
      loadPosts({ categoryId: "" });
      // mark seen when entering posts tab
      setLastSeen(newestPostId);
    }
    if (tab === "beneficios" && catIdBeneficios) {
      loadPosts({ categoryId: catIdBeneficios });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, catIdBeneficios]);

  async function onEnablePush() {
    setErrPush("");
    try {
      await enablePush({ categories: ["UIC"] });
      alert("✅ Push activado. Si hay novedades, vas a recibir notificaciones.");
    } catch (e) {
      console.error(e);
      const msg = (e && e.message) ? e.message : "No se pudo activar push.";
      setErrPush(msg);
      alert(`❌ ${msg}`);
    }
  }

  function openPost(p) {
    setSelectedPost(p);
    // marking as seen at least this post
    const id = Number(p?.id || 0);
    if (id) setLastSeen(Math.max(getLastSeen(), id));
  }

  function saveConfig() {
    setApiBase(apiBase);
    setWpBase(wpBase);
    alert("✅ Configuración guardada. Podés volver a intentar actualizar publicaciones / activar Push.");
  }

  const latestPost = posts?.[0] || null;

  return (
    <div className="container">
      <div className="topbar">
        <div>
          <h1 style={{margin:"8px 0"}}>UIC</h1>
          <div className="small">Campana — PWA Rev 1</div>
        </div>
        <button className="btn" onClick={onEnablePush}>Activar Push</button>
      </div>

      {errPush && (
        <div className="card" style={{border:"1px solid rgba(255,80,80,.35)"}}>
          <strong>Push</strong>
          <div className="small" style={{marginTop:6}}>{errPush}</div>
          <div className="small" style={{marginTop:6}}>
            {(!isStandalone() && /iPhone|iPad|iPod/i.test(navigator.userAgent || "")) ? (
              <>Tip iPhone: Safari → Compartir → “Agregar a pantalla de inicio”. Abrí desde el ícono y probá de nuevo.</>
            ) : null}
          </div>
        </div>
      )}

      {tab === "inicio" && (
        <>
          <div className="card">
            <div className="small">Accesos rápidos</div>
            <div className="grid" style={{marginTop:12}}>
              <a className="tile" href="https://uic-campana.com.ar/hacete-socio/" target="_blank" rel="noreferrer">Hacete socio</a>
              <a className="tile" href="https://uic-campana.com.ar/category/promocion-industrial/" target="_blank" rel="noreferrer">Promoción Industrial</a>
              <a className="tile" href="https://uic-campana.com.ar/category/beneficios/" target="_blank" rel="noreferrer">Beneficios</a>
              <a className="tile" href="https://uic-campana.com.ar/" target="_blank" rel="noreferrer">Sitio UIC</a>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{justifyContent:"space-between"}}>
              <div>
                <strong>Última publicación</strong>
                <div className="small">Lectura desde WordPress API</div>
              </div>
              <button className="btn" onClick={() => { setTab("posts"); }}>Ver todas</button>
            </div>

            <button className="btn" style={{marginTop:12}} onClick={() => loadPosts({ categoryId: "" })} disabled={loading}>
              {loading ? "Cargando..." : "Actualizar"}
            </button>

            {errPosts && (
              <div className="small" style={{marginTop:10, opacity:.9}}>
                {errPosts}
              </div>
            )}

            {latestPost && (
              <div className="postRow" style={{marginTop:12}} onClick={() => openPost(latestPost)}>
                <img className="thumb" alt="" src={pickFeaturedImage(latestPost) || "/icons/icon-192.png"} />
                <div>
                  <div style={{fontWeight:700}}>{stripHtml(latestPost.title?.rendered)}</div>
                  <div className="small">{stripHtml(latestPost.excerpt?.rendered).slice(0, 110)}…</div>
                </div>
              </div>
            )}

            {!latestPost && !loading && !errPosts && (
              <div className="small" style={{marginTop:12}}>Todavía no hay publicaciones para mostrar.</div>
            )}
          </div>
        </>
      )}

      {tab === "posts" && (
        <div className="card">
          <div className="row">
            <input
              className="input"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadPosts({ search: e.target.value });
              }}
            />
            <button className="btn" onClick={() => loadPosts({ search })} disabled={loading}>
              {loading ? "..." : "Buscar"}
            </button>
          </div>

          <div className="small" style={{marginTop:10}}>
            Tip: Luego mapeamos categorías exactas (Noticias, Revista, etc.) por slug.
          </div>

          <button className="btn" style={{marginTop:12}} onClick={() => loadPosts({ categoryId: "" })} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>

          {errPosts && (
            <div className="small" style={{marginTop:10, opacity:.9}}>
              {errPosts}
            </div>
          )}

          <div style={{marginTop:12}}>
            {posts.map(p => (
              <div key={p.id} className="postRow" onClick={() => openPost(p)}>
                <img className="thumb" alt="" src={pickFeaturedImage(p) || "/icons/icon-192.png"} />
                <div>
                  <div style={{fontWeight:700}}>{stripHtml(p.title?.rendered)}</div>
                  <div className="small">{stripHtml(p.excerpt?.rendered).slice(0, 90)}…</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "beneficios" && (
        <div className="card">
          <strong>Beneficios</strong>
          <div className="small" style={{marginTop:8}}>
            Mostrando publicaciones de la categoría “Beneficios” (si existe).
          </div>
          <button className="btn" style={{marginTop:12}} onClick={() => loadPosts({ categoryId: catIdBeneficios })} disabled={loading || !catIdBeneficios}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>

          {errPosts && (
            <div className="small" style={{marginTop:10, opacity:.9}}>
              {errPosts}
            </div>
          )}

          <div style={{marginTop:12}}>
            {posts.map(p => (
              <div key={p.id} className="postRow" onClick={() => openPost(p)}>
                <img className="thumb" alt="" src={pickFeaturedImage(p) || "/icons/icon-192.png"} />
                <div>
                  <div style={{fontWeight:700}}>{stripHtml(p.title?.rendered)}</div>
                  <div className="small">{stripHtml(p.excerpt?.rendered).slice(0, 90)}…</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "agenda" && (
        <div className="card">
          <strong>Agenda</strong>
          <div className="small" style={{marginTop:8}}>
            Próximamente: agenda institucional y eventos. Por ahora puede ser un embed.
          </div>
        </div>
      )}

      {tab === "ajustes" && (
        <div className="card">
          <strong>Ajustes</strong>
          <div className="small" style={{marginTop:8}}>
            - Para instalar: Safari → Compartir → “Agregar a pantalla de inicio”.<br/>
            - Push: requiere permisos, soporte del sistema y abrir desde el ícono (modo app).
          </div>

          <div style={{marginTop:12}}>
            <div className="small">API Base (uic-app-api)</div>
            <input className="input" value={apiBase} onChange={(e)=>setApiBaseState(e.target.value)} placeholder="https://TU-API.onrender.com" />
            <div className="small" style={{marginTop:10}}>WP Base (WordPress REST)</div>
            <input className="input" value={wpBase} onChange={(e)=>setWpBaseState(e.target.value)} placeholder="https://uic-campana.com.ar/wp-json/wp/v2" />

            <button className="btn" style={{marginTop:12}} onClick={saveConfig}>Guardar</button>
          </div>

          <div style={{marginTop:12}}>
            <a className="pill" href="https://uic-campana.com.ar/" target="_blank" rel="noreferrer">Abrir sitio</a>
          </div>
        </div>
      )}

      {selectedPost && (
        <div className="modal" onClick={() => setSelectedPost(null)}>
          <div className="modalInner" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{justifyContent:"space-between", alignItems:"center"}}>
              <strong>{stripHtml(selectedPost.title?.rendered)}</strong>
              <button className="btn" onClick={() => setSelectedPost(null)}>Cerrar</button>
            </div>
            <div style={{marginTop:10}} dangerouslySetInnerHTML={{ __html: selectedPost.content?.rendered || "" }} />
          </div>
        </div>
      )}

      <div className="footerTabs">
        <div className="tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={"tabBtn " + (tab === t.key ? "active" : "")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === "posts" && unreadCount > 0 && (
                <span className="badge">{unreadCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
