# UIC Data Bridge v1.0.0

Servicio backend interno, sin interfaz pública. Mantiene un segundo proyecto Neon como respaldo de lectura para la App UIC.

## Principio de seguridad
- `PRIMARY_DATABASE_URL`: base actual UIC. El bridge sólo la lee.
- `SECONDARY_DATABASE_URL`: nuevo proyecto Neon de contingencia. El bridge escribe la réplica.
- La App UIC sigue escribiendo únicamente en la base principal.
- Si la principal cae, Agenda puede leerse desde la secundaria en modo **solo lectura**.
- No hay doble escritura libre ni riesgo de dos bases maestras.

## Tablas replicadas
- `uic_events` (Agenda)
- `uic_comms` (Comunicaciones)
- `uic_socios` (Directorio)

## Render
Crear un nuevo **Web Service** apuntando a la carpeta `uic-data-bridge`.
No necesita frontend. La ruta `/` responde 404 deliberadamente.
Configurar las variables del `.env.example`.

## Primer arranque
Mientras la base principal siga bloqueada por cuota, el bridge no podrá copiar el contenido histórico. Esto es normal.
Cuando Neon principal vuelva a aceptar consultas, la sincronización inicial se ejecutará automáticamente y llenará la secundaria.
