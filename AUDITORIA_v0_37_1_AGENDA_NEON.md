# Auditoría técnica v0.37.1 — Agenda / Neon

## Hallazgo principal
En v0.37.0, `dbReady=false` o una excepción de PostgreSQL hacía que `/events` y `/events/meta` retornaran el JSON local. En Render ese almacenamiento no es una fuente persistente confiable. El resultado podía ser una Agenda visualmente vacía sin que Neon hubiese perdido los eventos.

También las operaciones POST/PUT/DELETE podían caer al JSON local si la DB fallaba, generando riesgo de divergencia entre lo que veía el administrador y lo almacenado realmente en Neon.

## Solución aplicada
- En Render/producción, Agenda depende obligatoriamente de PostgreSQL.
- Falla de DB => 503, nunca `items: []` por fallback.
- La PWA distingue “sin eventos” de “base temporalmente no disponible”.
- El pool se vigila y se reintenta automáticamente.
- `/health` ejecuta una consulta real a PostgreSQL.
- Se preserva el histórico completo de `uic_events`; no se ejecuta DELETE por ventana temporal.

## Riesgo residual externo
Si `DATABASE_URL` contiene credenciales inválidas o si el proyecto Neon es eliminado/suspendido, ninguna aplicación puede reconstruir esas credenciales automáticamente. La v0.37.1 evita pérdida silenciosa y detecta el problema de forma inmediata.

## Instalación
No crear nueva base ni cambiar tablas. Mantener la misma `DATABASE_URL` de Neon. En Render agregar/verificar `STRICT_DB_PERSISTENCE=true`. Recomendado: configurar Health Check Path del servicio API como `/health`.
