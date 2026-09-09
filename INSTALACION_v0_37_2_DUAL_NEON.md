# Instalación UIC App v0.37.2 — segundo Neon + Data Bridge

## 1. Crear el segundo proyecto Neon
Crear un proyecto Neon Free nuevo y obtener su cadena de conexión pooled. No modificar ni borrar el proyecto Neon actual.

## 2. API UIC existente en Render
Mantener la `DATABASE_URL` actual y agregar:

- `SECONDARY_DATABASE_URL=<cadena larga del nuevo Neon>`
- `STRICT_DB_PERSISTENCE=true`
- `DB_RETRY_MS=30000`
- `SECONDARY_SYNC_MS=21600000`

Desplegar la carpeta `uic-app-api` como hasta ahora.

## 3. Crear UIC Data Bridge en Render
Crear un NUEVO Web Service cuyo Root Directory sea `uic-data-bridge`.

Variables:
- `PRIMARY_DATABASE_URL=<misma cadena de la base UIC actual>`
- `SECONDARY_DATABASE_URL=<cadena del nuevo Neon>`
- `BRIDGE_TOKEN=<secreto largo aleatorio>`
- `SYNC_INTERVAL_MS=900000`
- `DATABASE_SSL=true`

No tiene frontend. `/` devuelve 404 deliberadamente. `/health` sirve sólo para diagnóstico.

## 4. Primer llenado
Si la base principal todavía está bloqueada por cuota, el log mostrará sync pendiente. No es un error de la v0.37.2.
En cuanto la primaria vuelva a aceptar consultas, el bridge copiará automáticamente Agenda, Comunicaciones y Socios y marcará el snapshot como válido.

## 5. Verificación
Abrir `/health` de la API UIC y confirmar:
- `persistence.connected: true` o, si la primaria está caída, `secondaryPersistence.connected: true`
- `agenda.continuityEnabled: true`
- `agenda.secondarySnapshotReady: true` una vez realizada la primera copia

## Regla importante
No cambiar `DATABASE_URL` de la API por la secundaria. La secundaria se carga exclusivamente en `SECONDARY_DATABASE_URL`.
