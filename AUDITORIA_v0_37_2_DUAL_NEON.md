# Auditoría técnica — UIC App v0.37.2 / Dual Neon

## Hallazgo de origen
La v0.37.1 confirmó por log que Neon principal rechazaba conexiones por cuota de transferencia excedida. La App ya no confundía esa caída con una agenda vacía, pero quedaba sin datos visibles mientras la base principal estuviera bloqueada.

## Corrección v0.37.2
Se incorpora un segundo proyecto Neon como réplica de continuidad y un servicio `uic-data-bridge` sin interfaz pública.

### Regla de autoridad
La base primaria es la única autoridad de escritura. La secundaria es read-only desde la perspectiva de continuidad de la App. Esto evita conflictos y divergencias por escritura simultánea.

### Agenda
- Lectura normal: primaria.
- Si primaria falla: secundaria sólo si tiene snapshot validado.
- Si primaria y secundaria fallan: 503 con mensaje de información no eliminada.
- Escrituras con primaria caída: bloqueadas.

### Sincronización
El bridge replica `uic_events`, `uic_comms` y `uic_socios`. Agenda y Socios se tratan como snapshot para reflejar también eliminaciones. La base secundaria registra `uic_bridge_meta` al terminar una copia exitosa.

### Limitación inicial
Mientras Neon principal continúe bloqueada por cuota, no existe una vía técnica segura para copiar desde ella los registros históricos. La secundaria comenzará a poblarse automáticamente apenas la primaria vuelva a aceptar consultas. Hasta entonces la App no usará la secundaria vacía.
