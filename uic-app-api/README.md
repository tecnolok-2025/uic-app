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

## GitHub Actions
Configurar secrets en el repo:
- API_URL = https://tu-api.onrender.com
- CRON_TOKEN = (mismo que en Render)
