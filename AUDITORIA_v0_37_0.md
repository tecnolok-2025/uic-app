# Auditoría técnica — UIC App v0.37.0

Fecha: 03/09/2026
Base auditada: v0.36.5

## Resultado general

La aplicación mantiene una arquitectura clara y funcional: PWA React/Vite, API Node/Express y persistencia PostgreSQL mediante `DATABASE_URL`. El cambio solicitado de Beneficios puede realizarse sin tocar el esquema de base de datos ni migrar información.

## Cambios aplicados en v0.37.0

1. **Beneficios pasa a portal externo**
   - El botón `Beneficios` de Inicio abre directamente `https://beneficios-uic.onrender.com/`.
   - Se elimina la pantalla interna anterior de Beneficios para evitar dos fuentes distintas de información.

2. **Versionado PWA más robusto**
   - La versión visible se obtiene de `uic-app-pwa/package.json`.
   - `cacheId`, `id` y `start_url` también se derivan de esa versión.
   - Esto reduce el riesgo de que iPhone/Android queden mostrando una release vieja por una desalineación manual de números de versión.

3. **Seguridad de restablecimiento de clave**
   - Se detectó que `/member/reset-password` podía ejecutarse sin autorización administrativa.
   - Desde v0.37.0 requiere `EVENT_ADMIN_TOKEN`.
   - La interfaz ya no realiza un reset público; informa al socio que debe solicitarlo a Administración UIC.

4. **Secreto de sesión de socios**
   - Si no se configura `MEMBER_TOKEN_SECRET` ni `EVENT_ADMIN_TOKEN`, la API genera un secreto efímero aleatorio en lugar de usar un secreto de desarrollo predecible.

5. **Documentación técnica**
   - Se actualizaron README y `.env.example` para reflejar PostgreSQL, variables de seguridad y configuración actual.

## Observaciones de auditoría pendientes / recomendadas

### A. Manual descargable desactualizado
El archivo público `public/manual_uic.pdf` y el DOCX raíz corresponden a una versión anterior (v0.31.0). La ayuda interna del código está más actualizada, pero conviene regenerar el manual descargable en una próxima revisión.

### B. Dependencia `xlsx@0.18.5`
La API usa `xlsx` para generar exportaciones. Esa versión del paquete tiene avisos de seguridad conocidos y no existe una actualización corregida en el registro npm tradicional. En esta app el código observado utiliza XLSX para **escritura/exportación**, no para leer planillas subidas por usuarios, lo que reduce la exposición al problema de prototype pollution; aun así se recomienda migrar a una biblioteca mantenida como `exceljs` en una revisión específica de exportaciones.

### C. CORS
El código permite `*` si `ALLOWED_ORIGINS` no está configurado. En Render debe mantenerse `ALLOWED_ORIGINS` limitado al origen real de la PWA.

### D. Build reproducible del API
El backend no incluía `package-lock.json` en la revisión recibida. Es recomendable generar y versionar uno en el repositorio para fijar las versiones exactas de dependencias.

### E. Archivo backup obsoleto
La revisión recibida contenía `uic-app-api/index.js.bak`, claramente anterior al backend actual. Se recomienda no versionar backups de código dentro de la release productiva para evitar confusiones.

## Validaciones realizadas sobre v0.37.0

- Parseo JSX de `App.jsx`: OK.
- Parseo JSX de `main.jsx`: OK.
- Sintaxis Node de `uic-app-api/index.js`: OK.
- Sintaxis de `vite.config.js`: OK.
- Versión PWA: 0.37.0.
- Versión API: 0.37.0.
- No existe `setTab("beneficios")` ni render interno `tab === "beneficios"`.
- El botón Beneficios referencia `https://beneficios-uic.onrender.com/`.
- El reset de clave requiere administrador.
- No se incorporaron migraciones ni cambios de esquema de PostgreSQL.

## QA recomendado al desplegar en Render

1. Abrir la PWA y confirmar versión `0.37.0` en Ajustes/footer.
2. Pulsar **Beneficios** y verificar que abra `https://beneficios-uic.onrender.com/`.
3. Probar en navegador de escritorio e iPhone instalado como PWA.
4. Ejecutar **Forzar actualización** una vez si el dispositivo conserva la release anterior.
5. Verificar Agenda, Socios, Mensajes, Trazabilidad y Publicaciones.
6. Confirmar que la API responde en `/health` y `/version`.
7. Verificar que el reset de clave de socio no pueda ejecutarse sin credencial administrativa.
8. Confirmar que `DATABASE_URL`, `EVENT_ADMIN_TOKEN`, `MEMBER_TOKEN_SECRET` y `ALLOWED_ORIGINS` estén configurados en Render.
