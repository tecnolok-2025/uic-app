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
