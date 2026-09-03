# UIC App API — v0.37.0

Backend Node/Express de UIC Campana. Usa PostgreSQL cuando `DATABASE_URL` está configurada y mantiene fallbacks locales solo para desarrollo/contingencia.

## Requisitos
- Node.js 18+

## Render
Variables principales: `DATABASE_URL`, `EVENT_ADMIN_TOKEN`, `MEMBER_TOKEN_SECRET`, `ALLOWED_ORIGINS`, `WP_MODE`, `WP_SITE_BASE` y, si se habilita push, las claves VAPID.

## Seguridad
- Operaciones administrativas protegidas con `EVENT_ADMIN_TOKEN`.
- Tokens de socio firmados con `MEMBER_TOKEN_SECRET` (o `EVENT_ADMIN_TOKEN` como fallback).
- Desde v0.37.0, el restablecimiento de clave de socio requiere autorización administrativa.

## Ejecución
- Instalar: `npm install`
- Iniciar: `npm start`
