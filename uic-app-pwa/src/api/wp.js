const WP = import.meta.env.VITE_WP_BASE || "https://uic-campana.com.ar/wp-json/wp/v2";

export async function fetchCategories() {
  const res = await fetch(`${WP}/categories?per_page=100&hide_empty=true`);
  if (!res.ok) throw new Error(`WP categories error: ${res.status}`);
  return await res.json();
}

export async function fetchPosts({ page = 1, perPage = 10, search = "", categoryId = "" }) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  params.set("_embed", "1");
  params.set("orderby", "date");
  params.set("order", "desc");
  if (search) params.set("search", search);
  if (categoryId) params.set("categories", String(categoryId));

  const url = `${WP}/posts?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WP posts error: ${res.status}`);
  return {
    items: await res.json(),
    total: Number(res.headers.get("X-WP-Total") || "0"),
    totalPages: Number(res.headers.get("X-WP-TotalPages") || "0"),
  };
}

export function pickFeaturedImage(post) {
  const media = post?._embedded?.["wp:featuredmedia"]?.[0];
  return media?.source_url || "";
}
