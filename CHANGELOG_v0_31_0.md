# UIC App — Versión 0.31.0 (01/03/2026)

## Cambios solicitados
- **Renombrado**: el acceso superior “Promoción Industrial” pasa a llamarse **Bolsa de trabajo** (por ahora, módulo placeholder).
- **Reubicación**: “Promoción Industrial” pasa a la barra inferior, abreviado como **Pro.Industrial**.
- **Barra inferior**: se reemplaza “Agenda” por **Manual** (Agenda sigue disponible desde Inicio).
- **Manual en la app**: nuevo tab **Manual** con guía de uso (y se adjunta manual actualizado en DOCX).
- **Acceso protegido**: el botón **Requerimientos inst.** ahora pide **clave** (sirve clave de socio o clave admin).

## Técnico
- PWA: cache-busting actualizado (**CACHE_ID uic-campana-v0310**) y `start_url` con `v=0.31.0`.
- API: nuevo endpoint `POST /access/verify` para validar clave (sin exponer identidad).
