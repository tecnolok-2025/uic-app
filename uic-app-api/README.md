# UIC App API — v0.37.0

Backend Node/Express de UIC Campana. Usa PostgreSQL/Neon como persistencia principal. Desde v0.37.1, la Agenda trabaja en modo estricto por defecto: si Neon no está disponible devuelve 503 y nunca simula una agenda vacía mediante JSON local. El fallback local sólo puede habilitarse explícitamente para desarrollo con `STRICT_DB_PERSISTENCE=false`.

## Requisitos
- Node.js 18+

## Render
Variables principales: `DATABASE_URL`, `STRICT_DB_PERSISTENCE=true`, `DB_RETRY_MS=30000`, `EVENT_ADMIN_TOKEN`, `MEMBER_TOKEN_SECRET`, `ALLOWED_ORIGINS`, `WP_MODE`, `WP_SITE_BASE` y, si se habilita push, las claves VAPID.

## Seguridad
- Operaciones administrativas protegidas con `EVENT_ADMIN_TOKEN`.
- Tokens de socio firmados con `MEMBER_TOKEN_SECRET` (o `EVENT_ADMIN_TOKEN` como fallback).
- Desde v0.37.0, el restablecimiento de clave de socio requiere autorización administrativa.

## Ejecución
- Instalar: `npm install`
- Iniciar: `npm start`
