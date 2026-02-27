import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// --- v0.26b hotfix ---
// Fix: Render build was failing with: ReferenceError: COMMIT is not defined
// We now derive commit safely from environment variables (Render/GitHub/etc.)

const APP_VERSION = '0.26.0'
const CACHE_ID = 'uic-campana-v026'
const START_URL = '/?v=0.26'

const commitRaw =
  process.env.RENDER_GIT_COMMIT ||
  process.env.GITHUB_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  ''

const commitShort = commitRaw ? commitRaw.slice(0, 7) : '(s/d)'
const buildTime = new Date().toISOString()

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      manifest: {
        id: START_URL,
        start_url: START_URL,
        name: 'UIC Campana',
        short_name: 'UIC',
        theme_color: '#0b2b4b',
        background_color: '#0b2b4b',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        cacheId: CACHE_ID,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html'
      }
    })
  ],

  // Constants usable from the app (App.jsx can display them)
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_CACHE_ID__: JSON.stringify(CACHE_ID),
    __APP_COMMIT__: JSON.stringify(commitShort),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),

    // Back-compat: if some code references these identifiers directly
    COMMIT: JSON.stringify(commitShort),
    BUILD_TIME: JSON.stringify(buildTime)
  }
})
