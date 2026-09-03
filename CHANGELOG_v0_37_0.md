# UIC App v0.37.0

## Cambios funcionales
- El botón **Beneficios** de Inicio deja de abrir la implementación interna anterior.
- Ahora abre directamente el portal oficial externo: `https://beneficios-uic.onrender.com/`.
- Se elimina la pantalla interna obsoleta de Beneficios para evitar duplicidad y mantenimiento innecesario.

## Auditoría y mantenimiento
- Versionado PWA centralizado desde `package.json`: versión visible, `cacheId`, `id` y `start_url` quedan sincronizados.
- El endpoint de restablecimiento de contraseña de socio deja de ser público y requiere autorización de administrador.
- Se actualizaron README y `.env.example` para reflejar PostgreSQL, seguridad y configuración actual.
- No se modifica el esquema de base de datos ni se borran datos persistentes.

## QA recomendado
1. Build de PWA sin errores.
2. Arranque de API sin errores de sintaxis.
3. Verificar que Beneficios abra `https://beneficios-uic.onrender.com/`.
4. Confirmar que ya no existe navegación interna al tab Beneficios.
5. Verificar que versión visible sea 0.37.0.
6. Verificar actualización de PWA/cache en navegador e instalación móvil.
7. Confirmar que `/member/reset-password` responda 401/403 sin credencial administrativa.
8. Confirmar que la DB PostgreSQL existente no requiere migración.
