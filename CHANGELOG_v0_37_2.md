# UIC App v0.37.2 — Continuidad con Neon secundario

Fecha: 09/09/2026

## Objetivo
Evitar que la Agenda deje de visualizarse cuando el proyecto Neon principal agota cuota o queda temporalmente inaccesible.

## Arquitectura
- Base primaria: Neon actual UIC. Sigue siendo la única base maestra de escritura.
- Base secundaria: nuevo proyecto Neon de respaldo.
- UIC Data Bridge: servicio backend interno, sin frontend, que replica Agenda, Comunicaciones y Socios de primaria a secundaria.
- La App lee Agenda desde la secundaria solamente cuando la primaria no responde y existe una instantánea secundaria validada.
- Altas, modificaciones y bajas siguen bloqueadas si la primaria no está disponible. No hay dos bases maestras.

## Protección contra agenda vacía
Una base secundaria recién creada NO se considera válida hasta que `uic_bridge_meta.last_success_at` confirme una sincronización completa. Esto evita mostrar una Agenda vacía antes de haber copiado los datos históricos.

## Consumo
- La réplica automática del bridge es cada 15 minutos por defecto; puede aumentarse.
- La API hace reconciliación de seguridad cada 6 horas si ambas bases están disponibles.
- Las escrituras de Agenda exitosas en primaria se reflejan también en secundaria.

## Endpoints
- `/health`: informa estado primario, secundario y si existe snapshot secundario utilizable.
- `/admin/sync-secondary`: sincronización manual protegida por `EVENT_ADMIN_TOKEN`.

## No destructivo
No se borra ni migra automáticamente la base primaria. El proyecto secundario es sólo respaldo de continuidad.
