// v0.4: WP via Backend Proxy para evitar CORS.
// Configuración (orden de prioridad):
// 1) localStorage: UIC_WP_BASE / UIC_API_BASE
// 2) env vars VITE_WP_BASE / VITE_API_BASE
// 3) defaults

const DEFAULT_WP = "https://uic-campana.com.ar/wp-json/wp/v2";

function getLocal(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function getApiBase() {
  return (
    getLocal("UIC_API_BASE") ||
    import.meta.env.VITE_API_BASE ||
    ""
  ).replace(/\/$/, "");
}

export function getWpBase() {
  return (
    getLocal("UIC_WP_BASE") ||
    import.meta.env.VITE_WP_BASE ||
    DEFAULT_WP
  ).replace(/\/$/, "");
}

export async function fetchCategories() {
  const apiBase = getApiBase();
  const wpBase = getWpBase();

  // Si hay API, usamos proxy (ideal). Si no, vamos directo a WP.
  const url = apiBase
    ? `${apiBase}/wp/categories?per_page=100`
    : `${wpBase}/categories?per_page=100&hide_empty=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`categories error: ${res.status}`);
  return await res.json();
}

export async function fetchPosts({ page = 1, perPage = 10, search = "", categoryId = "" }) {
  const apiBase = getApiBase();
  const wpBase = getWpBase();

  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  if (search) params.set("search", search);
  if (categoryId) params.set("categories", String(categoryId));

  const url = apiBase
    ? `${apiBase}/wp/posts?${params.toString()}`
    : `${wpBase}/posts?_embed=1&orderby=date&order=desc&${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`posts error: ${res.status}`);

  return {
    items: await res.json(),
    total: Number(res.headers.get("X-WP-Total") || res.headers.get("x-wp-total") || "0"),
    totalPages: Number(res.headers.get("X-WP-TotalPages") || res.headers.get("x-wp-totalpages") || "0"),
  };
}


export function pickFeaturedImage(post) {
  const media = post?._embedded?.["wp:featuredmedia"]?.[0];
  return media?.source_url || "";
}
