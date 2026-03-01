# UIC App v0.34.0

## Bolsa de Trabajo — Buscador y Tablero (mejoras)
- Buscador avanzado: agrega filtros por **Nivel**, **Experiencia**, **Educación**, **Capacitación**, **Trabaja actualmente**, **Especialidad exacta**, **Categoría de soldador**, **Máquinas herramienta (Mecánica)** e **Instrumentos (Eléctrica)**.
- Exportación Excel (Admin):
  - **Descargar Excel (completo)**: backup total de la base.
  - **Excel filtrado**: exporta respetando los filtros aplicados en pantalla.
- Tablero de registros (Admin/Socio con acceso):
  - Agrega conteos por **Categoría de soldador**, **Máquinas herramienta** e **Instrumentos**.
  - Vista de **especialidades por área** (desplegable) usando estadísticas del backend.

## API v0.34.0
- `/jobs/stats` ahora devuelve además `especialidad_by_area` y suma facetas para:
  - `soldador_categoria`
  - `herramientas_mecanica`
  - `instrumentos_electrica`
- `/jobs/search` incorpora filtros adicionales (mismos campos que el buscador).
- `/jobs/export` soporta exportación filtrada por query params (si se pasan).
