import { getApiBase, getWpBase } from "../config.js";

function buildUrl(base, path, params={}) {
  const u = new URL(path, base.endsWith("/") ? base : base + "/");
  Object.entries(params).forEach(([k,v]) => {
    if (v === "" || v === null || v === undefined) return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.json();
}

// Primary: direct WP API. Fallback: API proxy (/wp/*) if configured.
async function tryWpThenProxy(kind, params) {
  const WP = getWpBase();
  const API = getApiBase();
  const directUrl = (kind === "categories")
    ? buildUrl(WP, "categories", params)
    : buildUrl(WP, "posts", params);

  try {
    return await fetchJson(directUrl);
  } catch (e) {
    if (!API) throw e; // no fallback available
    const proxyUrl = (kind === "categories")
      ? buildUrl(API, "wp/categories", params)
      : buildUrl(API, "wp/posts", params);
    return await fetchJson(proxyUrl);
  }
}

export async function fetchCategories() {
  return await tryWpThenProxy("categories", { per_page: 100, hide_empty: true });
}

export async function fetchPosts({ page = 1, perPage = 10, search = "", categoryId = "" }) {
  const params = { page, per_page: perPage, _embed: 1 };
  if (search) params.search = search;
  if (categoryId) params.categories = categoryId;
  return await tryWpThenProxy("posts", params);
}

export function pickFeaturedImage(post) {
  try {
    const media = post?._embedded?.["wp:featuredmedia"]?.[0];
    return media?.source_url || "";
  } catch {
    return "";
  }
}
