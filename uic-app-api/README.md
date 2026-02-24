# uic-app-api — v0.1

API mínima para:
- entregar VAPID public key
- recibir suscripciones web push
- disparar notificaciones desde un cron (GitHub Actions)

## Requisitos
- Node.js 18+

## Local
1) Copiar `.env.example` a `.env` y completar VAPID keys.
2) `npm install`
3) `npm start`

## VAPID keys
Generar una vez:
- `npx web-push generate-vapid-keys`

## Render (Free)
Setear env vars:
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY
- VAPID_SUBJECT
- CRON_TOKEN
- ALLOWED_ORIGINS

## Agenda (eventos) — carga desde la app

Endpoints:
- `GET /events?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /events/meta`
- `POST /events` (requiere token)
- `PUT /events/:id` (requiere token)
- `DELETE /events/:id` (requiere token)

### Env vars (Render)

- `EVENT_ADMIN_TOKEN` = una clave que solo vos conozcas (se usa en el header `x-admin-token`).
- (opcional) `EVENTS_FILE` = path del JSON de eventos (por defecto: `uic-app-api/data/events.json`).

> Nota: en Render Free el filesystem puede resetearse en redeploy/dormir. Este MVP persiste en un JSON local.
> Si necesitás persistencia 100% garantizada, pasamos a una DB (Supabase/Postgres) en la próxima etapa.

## GitHub Actions
Configurar secrets en el repo:
- API_URL = https://tu-api.onrender.com
- CRON_TOKEN = (mismo que en Render)

## WordPress (publicaciones) — modo RSS (recomendado si NO tenés acceso al admin)

Si la REST API de WordPress está bloqueada por un plugin de seguridad (ej: iThemes) vas a ver 401 con
`itsec_rest_api_access_restricted`.

Para evitar depender del admin, esta API soporta **WP_MODE=rss** (por defecto) y lee el feed público:

- Feed global: `${WP_SITE_BASE}/feed/`
- Feed por categoría (si existe): `${WP_SITE_BASE}/category/<slug>/feed/`

### Variables de entorno sugeridas (Render)

- `WP_MODE` = `rss`
- `WP_SITE_BASE` = `https://uic-campana.com.ar/ar`  (o el base correcto de tu sitio)
- (opcional) `WP_BASE` solo si vas a usar REST

> Tip: probá el feed en el navegador: `https://uic-campana.com.ar/feed/` o `.../ar/feed/`.
Si abre XML, la app puede leer publicaciones.

