import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

const APP_VERSION = "0.28.9";

// Seguridad/UX: por defecto NO dejamos el modo admin "pegado" entre sesiones.
// El admin deberá reingresar la clave en Ajustes (evita que aparezca 'Admin ACTIVO' sin querer).
try {
  const keep = new URLSearchParams(location.search).get("keepAdmin");
  if (!keep) sessionStorage.removeItem("uic_admin_token");
} catch (_) {}
// PWA: registro explícito para updates más confiables.
// Evita el caso típico de "pantalla azul" cuando un Service Worker viejo
// sirve un index.html que apunta a assets (hash) que ya no existen.
import { registerSW } from "virtual:pwa-register";

const AUTO_RELOAD_FLAG = "uic_sw_auto_reloaded";

try {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Aceptamos el update automáticamente y recargamos UNA sola vez.
      try {
        if (!sessionStorage.getItem(AUTO_RELOAD_FLAG)) {
          sessionStorage.setItem(AUTO_RELOAD_FLAG, "1");
          updateSW(true);
          window.location.reload();
        }
      } catch {
        // Si falla sessionStorage, igual intentamos reload.
        window.location.reload();
      }
    },
    onOfflineReady() {
      // Sin UI: dejamos que funcione offline.
    },
    onRegisterError(err) {
      console.error("PWA register error", err);
    },
  });
} catch (e) {
  // No bloquea el arranque.
  console.warn("PWA register skipped", e);
}

const rootEl = document.getElementById("root");

function showFatal(e) {
  console.error(e);
  if (!rootEl) return;
  rootEl.innerHTML = `
    <div style="padding:16px;font-family:system-ui;color:#fff;background:#0b2542;min-height:100vh;">
      <h2 style="margin:0 0 8px 0;">Se produjo un error al iniciar la app</h2>
      <p style="margin:0 0 12px 0;opacity:.9;">Probá recargar. Si persiste, limpiá cache/Service Worker.</p>
      <button id="uic_reload" style="padding:10px 14px;border-radius:10px;border:0;background:#2b80ff;color:#fff;font-weight:700;">Recargar</button>
      <button id="uic_clear" style="margin-left:10px;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;">Limpiar cache</button>
      <pre style="white-space:pre-wrap;margin-top:14px;opacity:.8">${String(e?.message || e)}</pre>
    </div>
  `;
  setTimeout(() => {
    document.getElementById("uic_reload")?.addEventListener("click", () => window.location.reload());
    document.getElementById("uic_clear")?.addEventListener("click", async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (err) {
        console.warn(err);
      }
      window.location.href = `/?v=${APP_VERSION}&t=${Date.now()}`;
    });
  }, 0);
}

try {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e) {
  showFatal(e);
}

window.addEventListener("error", (ev) => {
  // Si el render inicial falló o quedó en blanco por un throw, mostramos fallback.
  if (rootEl && rootEl.childNodes.length === 0) showFatal(ev.error || ev.message);
});

window.addEventListener("unhandledrejection", (ev) => {
  if (rootEl && rootEl.childNodes.length === 0) showFatal(ev.reason || "unhandledrejection");
});
