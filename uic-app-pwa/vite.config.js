import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// v0.24: cache-bust fuerte para iOS/Android + build stamp visible.
const CACHE_ID = "uic-campana-v024";

export default defineConfig({
  define: {
    __UIC_BUILD_STAMP__: JSON.stringify(new Date().toISOString()),
    __UIC_CACHE_ID__: JSON.stringify(CACHE_ID),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      workbox: {
        cacheId: CACHE_ID,
        cleanupOutdatedCaches: true,
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
        id: "/?v=0.24",
        start_url: "/?v=0.24",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
