# UIC APP — Estado del proyecto (snapshot)

**Release actual:** 0.37.0

## Arquitectura
- **PWA:** React + Vite + PWA (vite-plugin-pwa) — carpeta `uic-app-pwa/`
- **API:** Node/Express — carpeta `uic-app-api/`
- **DB:** PostgreSQL (via `DATABASE_URL` en Render)

## Deploy (Render)
- PWA: build `npm ci && npm run build`
- API: `node index.js` (usa `DATABASE_URL` si existe)

## Reglas operativas (NO romper)
1. **Versión única visible**: la PWA deriva versión visible, `cacheId`, `id` y `start_url` desde `uic-app-pwa/package.json`.
2. Cada release incrementa versión en:
   - `uic-app-pwa/package.json` + `package-lock.json`
   - `uic-app-api/package.json`
3. Antes de publicar: pasar checklist de QA (ver `RELEASE_CHECKLIST.md`).
4. El botón **Beneficios** abre el portal externo `https://beneficios-uic.onrender.com/`; no debe volver a usar una pantalla interna.

## Módulos principales
- Inicio / Publicaciones (WordPress feed)
- Trazabilidad
- Manual (PDF)
- Ajustes (admin token, forzar actualización, etc.)

## Problemas históricos y fixes clave
- Cache PWA/SW: puede dejar iPhone/Android desfasados → usar “Forzar actualización” y asegurar release correcto.
- Bolsa de trabajo: localidad en mobile se “pegaba” cuando era datalist → en 0.35.0 se usa `<select>` + “Limpiar”.
- Accesos rápidos: en 0.36.0 se oculta “Bolsa de trabajo” y se reemplaza por “Talento PyME” con link externo e ícono.
- Versiones múltiples en App.jsx/main.jsx → en 0.35.0 se centraliza en `src/version.js`.


## Cambios v0.36.1
- Requerimientos institucionales pasa a ser acceso directo externo sin solicitud de clave.
- Se elimina el modal de ingreso de clave para ese botón.
- Se actualiza versión/cache PWA a 0.36.1.


## Cambios v0.36.5
- Reemplazo de Pro.Industrial por Trazabilidad.
- Tablero administrativo con métricas de visitas, IPs, botones, pantallas e histórico de almacenamiento.
- Mejora visual de botones superiores/accesos rápidos.


## Cambios v0.37.0
- Beneficios pasa a acceso externo directo a `https://beneficios-uic.onrender.com/`.
- Se elimina la pantalla interna obsoleta de Beneficios.
- Se centraliza el versionado PWA para reducir errores de caché/release.
- Se protege el reset de contraseña de socios con autorización administrativa.
- Se actualiza documentación técnica y variables de entorno.
