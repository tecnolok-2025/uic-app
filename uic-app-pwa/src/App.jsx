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
          <div className="small">Campana — PWA v0.1</div>
        </div>
        <button className="btn" onClick={onEnablePush}>Activar Push</button>
      </div>

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
                <strong>Últimas publicaciones</strong>
                <div className="small">Lectura desde WordPress API</div>
              </div>
              <button className="btn" onClick={() => { setTab("posts"); }}>Ver todas</button>
            </div>

            <button className="btn" style={{marginTop:12}} onClick={() => loadPosts({ categoryId: "" })} disabled={loading}>
              {loading ? "Cargando..." : "Actualizar"}
            </button>

            {posts.slice(0,5).map(p => {
              const img = pickFeaturedImage(p);
              return (
                <div key={p.id} className="card" onClick={() => setSelectedPost(p)} style={{cursor:"pointer"}}>
                  <div className="row">
                    {img ? <img className="thumb" src={img} alt="" /> : null}
                    <div style={{flex:1}}>
                      <div dangerouslySetInnerHTML={{__html: p.title?.rendered || ""}} />
                      <div className="small">{new Date(p.date).toLocaleDateString("es-AR")} · {stripHtml(p.excerpt?.rendered || "").slice(0,120)}...</div>
                    </div>
                  </div>
                </div>
              );
            })}
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
          <div className="small" style={{marginTop:8}}>
            - Para instalar: “Agregar a pantalla de inicio” en el navegador del celular. <br/>
            - Push: requiere permisos y soporte del sistema.
          </div>
          <div style={{marginTop:12}}>
            <a className="pill" href="https://uic-campana.com.ar/" target="_blank" rel="noreferrer">Abrir sitio</a>
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
