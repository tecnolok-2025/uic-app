# uic-app-pwa (PWA) — v0.1

## Requisitos
- Node.js 18+ recomendado

## Setup
1) Copiar `.env.example` a `.env` y completar `VITE_API_BASE` cuando tengas la API en Render.
2) Instalar dependencias:
   - `npm install`
3) Desarrollo:
   - `npm run dev`
4) Build:
   - `npm run build`

## Íconos
Están en `public/icons/`:
- icon-192.png
- icon-512.png

## Nota
Este MVP consume publicaciones desde WordPress REST API.


## Rev 1 (2026-02-24)
- Agregado Service Worker custom para Push (iOS requiere instalar como app).
- Fallback de publicaciones vía API proxy (/wp/*) para evitar problemas de CORS/WP.
- Ajustes: configuración editable de API Base y WP Base (localStorage).
- Badge rojo con cantidad de publicaciones nuevas (desde última lectura).
