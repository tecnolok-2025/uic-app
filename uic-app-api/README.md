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

## v0.37.2 — Segundo Neon de continuidad
Configurar `SECONDARY_DATABASE_URL` para habilitar respaldo de lectura de Agenda. La secundaria nunca reemplaza a la primaria como base maestra. Si la primaria cae, sólo se utiliza la secundaria cuando existe un snapshot previamente validado por `uic_bridge_meta`.

El servicio complementario `uic-data-bridge` realiza la copia de Agenda, Comunicaciones y Socios. Mientras la primaria esté bloqueada por cuota, el bridge esperará y reintentará; no mostrará como válida una base secundaria vacía.
