import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// v0.28.3: endurecemos el update de PWA para evitar "pantalla azul" por SW viejo
// sirviendo index.html con assets que ya no existen (hash cambiado).
const CACHE_ID = "uic-campana-v0291";
// Render suele exponer el commit como RENDER_GIT_COMMIT. Si no existe, dejamos vacío.
const COMMIT = process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || process.env.COMMIT_SHA || "";

export default defineConfig({
  define: {
    __UIC_BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
    __UIC_CACHE_ID__: JSON.stringify(CACHE_ID),
    __UIC_COMMIT__: JSON.stringify(COMMIT),
  },
  plugins: [
    react(),
    VitePWA({
      // Usamos "prompt" pero lo resolvemos automáticamente desde main.jsx
      // para forzar activación inmediata + reload (más robusto que autoUpdate en iOS).
      registerType: "prompt",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      workbox: {
        cacheId: CACHE_ID,
        cleanupOutdatedCaches: true,
        // clave para updates confiables:
        // - el SW nuevo se activa sin esperar cerrar pestañas
        // - reclama clientes
        clientsClaim: true,
        skipWaiting: true,
        // En algunos iOS, las navegaciones quedan cacheadas agresivamente;
        // cambiamos start_url + cacheId para forzar nueva precache.
      },
      manifest: {
        name: "UIC Campana",
        short_name: "UIC",
        description: "Publicaciones, agenda y comunicaciones UIC Campana",
        theme_color: "#0b2a4a",
        background_color: "#0b2a4a",
        display: "standalone",
        // start_url versionado para que iOS trate la instalación como nueva
        id: "/?v=0.29.1",
        start_url: "/?v=0.29.1",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
