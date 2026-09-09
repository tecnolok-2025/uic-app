# UIC App v0.37.1 — Agenda protegida / Neon

Fecha: 09/09/2026

## Motivo
La Agenda podía aparecer vacía cuando PostgreSQL/Neon no estaba disponible. El backend ocultaba el fallo utilizando automáticamente un JSON local vacío. Esto generaba la impresión de pérdida de información aunque los eventos continuaran en Neon.

## Correcciones
1. Persistencia estricta para Agenda en Render/producción.
2. Sin fallback JSON silencioso en GET/POST/PUT/DELETE de Agenda.
3. HTTP 503 explícito ante indisponibilidad de Neon.
4. Mensaje en PWA: “Agenda temporalmente no disponible. La información no fue eliminada.”
5. Botón “Reintentar conexión”.
6. Reconexión automática de PostgreSQL cada 30 segundos.
7. Health check real contra Neon (`SELECT 1`) y conteo de eventos.
8. Diagnóstico seguro de host/base/usuario, nunca contraseña.
9. Se elimina la depuración destructiva de eventos por antigüedad: la ventana de Agenda es sólo visual.
10. Versionado PWA/API actualizado a 0.37.1.

## Variables nuevas
- `STRICT_DB_PERSISTENCE=true`
- `DB_RETRY_MS=30000`

No requiere migración de tablas ni modificación de los datos existentes en Neon.
