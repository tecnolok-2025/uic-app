# RELEASE_CHECKLIST — Antes de cerrar una versión

## Identidad / Versión
- [ ] Ajustes muestra **la misma versión** en iPhone y Android
- [ ] Render build log muestra `uic-app-pwa@X.Y.Z`
- [ ] “Forzar actualización” funciona y no queda en loop

## Login / Roles
- [ ] Portal socio: login OK
- [ ] Admin: activar y desactivar OK

## Bolsa de trabajo (CV)
- [ ] Alta CV: OK
- [ ] Buscar CV (admin/socio): OK
- [ ] Filtro Localidad: se puede cambiar y **limpiar**
- [ ] “Limpiar filtros”: resetea todos los filtros
- [ ] Export admin (si está habilitado): descarga OK

## Persistencia DB
- [ ] Cargar CV, redeploy, y confirmar que sigue apareciendo (DB OK)

## Revisión rápida de UI
- [ ] Header/logo render OK (sin cortes)
- [ ] Navegación inferior OK
- [ ] Manual PDF descarga OK

## Agenda / Neon (v0.37.1+)
- [ ] `/health` responde 200 con `persistence.connected: true`
- [ ] `/health` muestra `agenda.protectedFromFallback: true`
- [ ] Agenda muestra eventos existentes después de redeploy
- [ ] Simular DB no disponible: Agenda muestra aviso y NO calendario vacío
- [ ] Con DB caída, alta/edición/borrado devuelve 503 y NO escribe JSON local
- [ ] Restaurar DB: la conexión se recupera automáticamente sin redeploy
- [ ] Confirmar que los eventos fuera de la ventana visual no se eliminan de Neon

## Dual Neon / continuidad (v0.37.2+)
- [ ] Crear segundo proyecto Neon y copiar su pooled connection string.
- [ ] Configurar `SECONDARY_DATABASE_URL` en `uic-campana-api`.
- [ ] Crear servicio Render `uic-data-bridge` con Root Directory `uic-data-bridge`.
- [ ] Configurar `PRIMARY_DATABASE_URL`, `SECONDARY_DATABASE_URL` y `BRIDGE_TOKEN` en el bridge.
- [ ] Confirmar `/health` API: `agenda.continuityEnabled=true`.
- [ ] Luego de la primera sincronización, confirmar `agenda.secondarySnapshotReady=true`.
- [ ] Simular caída primaria sólo después de validar que la secundaria tiene eventos.
