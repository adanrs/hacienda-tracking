# Word, guía de movilización del MAG y documentos de custodia CIISA

## Word (.docx) en el importador

`lib/importador/archivos.js` lee `word/document.xml` con jszip. Cada tabla de Word se convierte en una hoja, igual que una tabla HTML de un correo. Los párrafos quedan como textos sueltos. Los formatos de documentos reciben además el texto corrido, con las celdas separadas por tabulador.

Un `.doc` de Word 97-2003 no se lee. El usuario recibe este mensaje: «guárdelo como .docx o súbalo como PDF o foto».

Aceptan `.docx`:
- ganadero-sg
- sacrificio-ciisa
- marmoleo-camara
- reporte-produccion-ciisa
- catalogo-cortes
- guia-movilizacion
- custodia-ciisa

No lo aceptan `solicitud-deshuese-excel` ni `inventario-ciisa`, porque leen el libro de Excel tal cual.

## Guía de movilización del MAG (`guia-movilizacion`)

Es el formulario FTZ-02 del SENASA, por ejemplo la guía EH0204095. Entra como:
- PDF con texto;
- `.docx`;
- texto;
- foto, con «Cargar por foto». Las instrucciones para el modelo de visión están en `lib/vision.js`.

Se pueden cargar varias guías a la vez. Varias fotos leídas seguidas se separan en el membrete «SERVICIO NACIONAL DE SALUD ANIMAL». La página 2 se une a la página 1 por el número de la guía.

**Qué guarda.**
- `guias_movilizacion`: número, fecha, hora, autorización, origen y destino con su CUE, transportista, placa, conductor y cantidad de bovinos declarada.
- `guia_movilizacion_animales`: una fila por bovino, con su DIIO, sexo y raza.

**Cómo se liga cada animal.** El DIIO de la guía y la I.E. de Ganadero SG son el mismo chip. Se comparan por `claveChip`: «188» más la serie sin ceros a la izquierda. Así, 188001057994 equivale a A0020000188000001057994.
- Si un solo animal tiene esa I.E., el DIIO se liga a ese animal.
- Si ningún animal la tiene, o la tienen varios, el DIIO queda «sin animal». Se liga a mano en `/guias-movilizacion/:id`.
- Un ligue hecho a mano (`vinculo = 'manual'`) no cambia al volver a importar la guía.

**Guía de transporte de la app.** Si los animales ligados salieron en una guía de transporte de la app el mismo día, el número oficial se copia a `guias_transporte.guia_movilizacion` y a `transporte.guia_movilizacion`. Solo se copia donde ese campo está vacío.

**Volver a importar.** No duplica nada: la llave es el número de la guía. Si el texto cambió, se actualizan el encabezado y las filas, y se quitan los DIIO que ya no vienen.

## Documentos de custodia CIISA (`custodia-ciisa`)

Son dos documentos de la bodega 107 EQTB TEMPISQUE:
- ASE, «Ajuste de salida en custodia»;
- TRE, «Traslado de inventario en custodia».

Entran como foto, PDF, `.docx`, `.xlsx` o texto. Varios documentos en el mismo texto se separan en el membrete «CENTRO INTERNACIONAL DE INVERSIONES».

**Qué guarda.**
- `documentos_custodia`: tipo, número, fecha, bodegas, estado, observaciones, Lote CC, RES, animal y totales. Guarda dos juegos de totales: la suma de las líneas y el total impreso en el documento.
- `documentos_custodia_lineas`: código, código equivalente, descripción, cajas y kg.

**Lote CC y RES.** Se toman de las Observaciones, por ejemplo «CORTES FINOS LOTE 35 / RES 5094». LOTE es el Lote CC (`lotes_cc_aretes`) y RES es el número de canal (`sacrificios.numero_canal`). La búsqueda cubre los 180 días antes de la fecha del documento.

**Cómo se liga el animal.**
- Si LOTE y RES apuntan a un mismo animal, se liga.
- Si solo uno de los dos da un único animal, se liga con un aviso para confirmarlo.
- Si hay varios candidatos, o LOTE y RES no coinciden, el documento queda sin animal. Se liga a mano en `/documentos-custodia/:id`.

**Equivalencias de código.** Están en `EQUIVALENCIAS_CUSTODIA` (`data/catalogo-ciisa.js`):
- 25000 BCH WAGYU equivale a 22229;
- 25002 TRIMMING WAGYU equivale a 11163.

**Volver a importar.** No duplica nada: la llave es el tipo más el número. Si el texto cambió, las líneas se reemplazan.

## Dónde se consulta

- `/guias-movilizacion` y `/documentos-custodia`: lista y detalle.
- El historial de importaciones, en las tablas `importaciones` e `importaciones_bitacora`.
- La ficha del animal (`GET /api/animales/:id`): tarjeta «Documentos» y línea de tiempo.
