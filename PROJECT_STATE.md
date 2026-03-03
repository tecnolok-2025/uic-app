# UIC APP — Estado del proyecto (snapshot)

**Release actual:** 0.35.0

## Arquitectura
- **PWA:** React + Vite + PWA (vite-plugin-pwa) — carpeta `uic-app-pwa/`
- **API:** Node/Express — carpeta `uic-app-api/`
- **DB:** PostgreSQL (via `DATABASE_URL` en Render)

## Deploy (Render)
- PWA: build `npm ci && npm run build`
- API: `node index.js` (usa `DATABASE_URL` si existe)

## Reglas operativas (NO romper)
1. **Versión única visible**: la PWA lee `APP_VERSION` desde `uic-app-pwa/package.json` (no hardcode).
2. Cada release incrementa versión en:
   - `uic-app-pwa/package.json` + `package-lock.json`
   - `uic-app-api/package.json`
3. Antes de publicar: pasar checklist de QA (ver `RELEASE_CHECKLIST.md`).

## Módulos principales
- Inicio / Publicaciones (WordPress feed)
- Pro.Industrial (Bolsa de trabajo: alta CV + búsqueda + export admin)
- Manual (PDF)
- Ajustes (admin token, forzar actualización, etc.)

## Problemas históricos y fixes clave
- Cache PWA/SW: puede dejar iPhone/Android desfasados → usar “Forzar actualización” y asegurar release correcto.
- Bolsa de trabajo: localidad en mobile se “pegaba” cuando era datalist → en 0.35.0 se usa `<select>` + “Limpiar”.
- Versiones múltiples en App.jsx/main.jsx → en 0.35.0 se centraliza en `src/version.js`.
