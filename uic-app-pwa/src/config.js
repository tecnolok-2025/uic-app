// Runtime config with safe defaults.
// Allows overriding API/WP base without rebuild via localStorage.
const LS_API = "UIC_API_BASE";
const LS_WP = "UIC_WP_BASE";

export function getApiBase() {
  return (localStorage.getItem(LS_API) || "").trim() || (import.meta.env.VITE_API_BASE || "").trim();
}
export function setApiBase(v) {
  localStorage.setItem(LS_API, (v || "").trim());
}
export function getWpBase() {
  return (localStorage.getItem(LS_WP) || "").trim() || (import.meta.env.VITE_WP_BASE || "https://uic-campana.com.ar/wp-json/wp/v2").trim();
}
export function setWpBase(v) {
  localStorage.setItem(LS_WP, (v || "").trim());
}

// Helpers
export function isStandalone() {
  // iOS + modern browsers
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}
