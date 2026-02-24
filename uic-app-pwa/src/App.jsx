import React, { useEffect, useMemo, useState } from "react";
import { fetchCategories, fetchPosts, pickFeaturedImage } from "./api/wp.js";
import { enablePush } from "./api/push.js";

const TABS = [
  { key: "inicio", label: "Inicio" },
  { key: "posts", label: "Publicaciones" },
  { key: "beneficios", label: "Beneficios" },
  { key: "agenda", label: "Agenda" },
  { key: "ajustes", label: "Ajustes" },
];

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return div.textContent || div.innerText || "";
}

export default function App() {
  const [tab, setTab] = useState("inicio");
  const [cats, setCats] = useState([]);
  const [catMap, setCatMap] = useState({});
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);
  const [apiBase, setApiBase] = useState(getApiBase());
  const [wpBase, setWpBase] = useState(getWpBase());
  const [settingsMsg, setSettingsMsg] = useState("");

  const catIdBeneficios = useMemo(() => {
    const found = cats.find(c => (c.slug || "").includes("benef"));
    return found?.id || "";
  }, [cats]);

  useEffect(() => {
    (async () => {
      try {
        const c = await fetchCategories();
        setCats(c);
        const m = {};
        c.forEach(x => { m[x.id] = x; });
        setCatMap(m);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    if (tab === "posts") loadPosts({ categoryId: "" });
    if (tab === "beneficios") loadPosts({ categoryId: catIdBeneficios });
  }, [tab, catIdBeneficios]);

  async function loadPosts({ categoryId }) {
    setLoading(true);
    try {
      const data = await fetchPosts({ page: 1, perPage: 12, search, categoryId });
      setPosts(data.items);
    } catch (e) {
      console.error(e);
      alert("No se pudo cargar publicaciones. Revisá conexión / WP API.");
    } finally {
      setLoading(false);
    }
  }

  function saveSettings() {
    try {
      const api = (apiBase || "").trim().replace(/\/$/, "");
      const wp = (wpBase || "").trim().replace(/\/$/, "");

      if (api) localStorage.setItem("UIC_API_BASE", api);
      else localStorage.removeItem("UIC_API_BASE");

      if (wp) localStorage.setItem("UIC_WP_BASE", wp);
      else localStorage.removeItem("UIC_WP_BASE");

      setSettingsMsg("Guardado. Actualizando...");
      // recargar publicaciones
      setTimeout(() => {
        setSettingsMsg("");
        // volvemos a cargar categorías y posts
        loadCategories();
        loadPosts(1, "");
      }, 300);
    } catch (e) {
      setSettingsMsg("No se pudo guardar la configuración.");
    }
  }

  async function onEnablePush() {
    try {
      await Notification.requestPermission();
      await enablePush({ categories: ["UIC"] });
      alert("Notificaciones activadas (si tu dispositivo lo soporta).");
    } catch (e) {
      console.error(e);
      alert("No se pudo activar push. Ver consola / configuración.");
    }
  }

  if (selectedPost) {
    const img = pickFeaturedImage(selectedPost);
    return (
      <div className="container">
        <div className="row" style={{justifyContent:"space-between"}}>
          <button className="btn" onClick={() => setSelectedPost(null)}>← Volver</button>
          <a className="pill" href={selectedPost.link} target="_blank" rel="noreferrer">Abrir en web</a>
        </div>

        <div className="card">
          <h2 style={{marginTop:0}} dangerouslySetInnerHTML={{__html: selectedPost.title?.rendered || ""}} />
          <div className="small">{new Date(selectedPost.date).toLocaleString("es-AR")}</div>
          {img ? <img src={img} alt="" style={{width:"100%", borderRadius:12, marginTop:12}} /> : null}
          <div style={{marginTop:12, lineHeight:1.5}} dangerouslySetInnerHTML={{__html: selectedPost.content?.rendered || ""}} />
        </div>

        <div className="footerTabs">
          <div className="tabs">
            {TABS.map(t => (
              <button key={t.key} className={"tabBtn " + (tab===t.key ? "active":"")} onClick={() => { setTab(t.key); }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="row" style={{justifyContent:"space-between"}}>
        <div>
          <h1 style={{margin:"8px 0"}}>UIC</h1>
          <div className="small">Campana</div>
        </div>
        <button className="btn" onClick={onEnablePush}>Activar Push</button>
      </div>

      {tab === "inicio" && (
        <>
          <div className="card">
            <div className="small">Accesos rápidos</div>
            <div className="quickGrid">
              <a className="quickTile" href="https://uic-campana.com.ar/hacete-socio/" target="_blank" rel="noreferrer"><span className="qtIcon">🤝</span><span>Hacete socio</span></a>
              <a className="quickTile" href="https://uic-campana.com.ar/category/promocion-industrial/" target="_blank" rel="noreferrer"><span className="qtIcon">🏭</span><span>Promoción Industrial</span></a>
              <a className="quickTile" href="https://uic-campana.com.ar/category/beneficios/" target="_blank" rel="noreferrer"><span className="qtIcon">🎁</span><span>Beneficios</span></a>
              <a className="quickTile" href="https://uic-campana.com.ar/" target="_blank" rel="noreferrer"><span className="qtIcon">🌐</span><span>Sitio UIC</span></a>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{justifyContent:"space-between"}}>
              <div>
                <strong>Últimas publicaciones</strong>
                <div className="small">Lectura desde WordPress API</div>
              </div>
              <button className="btn" onClick={() => { setTab("posts"); }}>Ver todas</button>
            </div>

            <button className="btn" style={{marginTop:12}} onClick={() => loadPosts({ categoryId: "" })} disabled={loading}>
              {loading ? "Cargando..." : "Actualizar"}
            </button>

            <div className="carousel">{posts.slice(0, 10).map((p) => {
              const img = pickFeaturedImage(p);
              return (
                <div
                  key={p.id}
                  className="postMini"
                  onClick={() => setSelectedPost(p)}
                  style={{ cursor: "pointer" }}
                >
                  {img ? <img className="postMiniThumb" src={img} alt="" /> : null}
                  <div className="postMiniTitle" dangerouslySetInnerHTML={{ __html: p.title.rendered }} />
                </div>
              );
            })}
            </div>
          </div>
        </>
      )}

      {tab === "posts" && (
        <div className="card">
          <div className="row">
            <input className="input" placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn" onClick={() => loadPosts({ categoryId: "" })} disabled={loading}>{loading ? "..." : "Buscar"}</button>
          </div>
          <div className="small" style={{marginTop:10}}>
            Tip: luego mapeamos categorías exactas (Noticias, Revista, etc.) por slug.
          </div>

          {posts.map(p => {
            const img = pickFeaturedImage(p);
            return (
              <div key={p.id} className="card" onClick={() => setSelectedPost(p)} style={{cursor:"pointer"}}>
                <div className="row">
                  {img ? <img className="thumb" src={img} alt="" /> : null}
                  <div style={{flex:1}}>
                    <div dangerouslySetInnerHTML={{__html: p.title?.rendered || ""}} />
                    <div className="small">{new Date(p.date).toLocaleDateString("es-AR")} · {stripHtml(p.excerpt?.rendered || "").slice(0,140)}...</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "beneficios" && (
        <div className="card">
          <div className="row" style={{justifyContent:"space-between"}}>
            <div>
              <strong>Beneficios</strong>
              <div className="small">Categoría detectada automáticamente por slug</div>
            </div>
            <button className="btn" onClick={() => loadPosts({ categoryId: catIdBeneficios })} disabled={loading}>
              {loading ? "Cargando..." : "Actualizar"}
            </button>
          </div>

          {!catIdBeneficios ? <div className="small" style={{marginTop:12}}>No se detectó categoría Beneficios. Luego la fijamos por ID/slug.</div> : null}

          {posts.map(p => (
            <div key={p.id} className="card" onClick={() => setSelectedPost(p)} style={{cursor:"pointer"}}>
              <div dangerouslySetInnerHTML={{__html: p.title?.rendered || ""}} />
              <div className="small">{new Date(p.date).toLocaleDateString("es-AR")}</div>
            </div>
          ))}
        </div>
      )}

      {tab === "agenda" && (
        <div className="card">
          <strong>Agenda</strong>
          <div className="small" style={{marginTop:8}}>
            MVP placeholder. En v0.2 se conecta a categoría “eventos” y/o Google Calendar embed.
          </div>
        </div>
      )}

      {tab === "ajustes" && (
        <div className="card">
          <strong>Ajustes</strong>

          <div className="small" style={{ marginTop: 8 }}>
            Acá podés configurar las URLs sin volver a compilar la app.
          </div>

          <div className="formRow">
            <label>API Base (backend Render)</label>
            <input
              className="input"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://uic-campana-api.onrender.com"
            />
            <div className="hint">Se usa para Push y para el proxy de publicaciones.</div>
          </div>

          <div className="formRow">
            <label>WP Base (WordPress JSON)</label>
            <input
              className="input"
              value={wpBase}
              onChange={(e) => setWpBase(e.target.value)}
              placeholder="https://TU-SITIO/wp-json/wp/v2"
            />
            <div className="hint">Si tu WordPress cambia de dominio, lo ajustás acá.</div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button className="pill" onClick={saveSettings}>Guardar</button>
            <a className="pill" href="https://uic-campana.com.ar/" target="_blank" rel="noreferrer">Abrir sitio</a>
          </div>

          {settingsMsg && <div className="small" style={{ marginTop: 10 }}>{settingsMsg}</div>}

          <div className="small" style={{ marginTop: 12 }}>
            Nota: para instalar en iPhone/Android, usar “Agregar a pantalla de inicio”.
          </div>
        </div>
      )}


      <div className="footerTabs">
        <div className="tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={"tabBtn " + (tab===t.key ? "active":"")}
              onClick={() => { setTab(t.key); }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}