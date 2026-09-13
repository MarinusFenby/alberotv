# Canal Extremadura: reparación de lectura de parrilla, 13/09/2026

Fuente: PDF oficial del 7 al 13 de septiembre, conservado como fixture de regresión.

La lectura anterior usaba la línea del título para estimar la hora y una ventana
vertical de texto que podía crear dos títulos para el mismo bloque. La nueva
lectura transforma las coordenadas de los bordes del PDF, aísla cada celda y
consulta la primera fila horaria de esa celda. No estima horas si faltan bordes.
El salto de 23:xx a 00:xx añade un día a la fecha de la columna, también al
cambiar de mes o año.

Resultados verificados (Europe/Madrid):

| Columna / emisión | Fecha real | Inicio TV |
| --- | --- | --- |
| Martes: Don Benito | 08/09 | 18:15 |
| Sábado: Almendralejo | 12/09 | 21:00 |
| Domingo: Tierra de Toros | 13/09 | 13:00 |
| Domingo: Higuera la Real | 13/09 | 18:30 |
| Madrugada de la columna domingo: Tierra de Toros | 14/09 | 02:30 |

La revisión visual preliminar indicó 02:45 por error: el borde superior está
en la fila 02:30, confirmado con la geometría. No hay identificador de episodio
que permita asegurar que ambos pases de Tierra de Toros son el mismo capítulo.
La hora TV de Don Benito no sustituye la hora del festejo confirmada por otras
fuentes (18:30); se mantienen las protecciones de autoridad del merge.

Pruebas: PDF real, títulos completos sin programas vecinos, ausencia de bordes,
cambio de año, movimiento del título dentro del bloque y regresiones previas.
17 pruebas pasan. Merge completo: 551 fichas, una sola de Almendralejo.

Alcance: extractor y JSON generado; no cambia imagen del backend, base de datos,
presupuestos ni Telegram. Copia previa de API en el servidor:
`/opt/alberotv/pdf-grid-repair-20260913/program-before.json`.
El commit padre conserva todos los archivos anteriores. Rollback: revertir el
commit de esta reparación y regeneraciones posteriores que incorporen sus datos;
no revertir cambios ajenos ni restaurar indiscriminadamente la base de datos.
