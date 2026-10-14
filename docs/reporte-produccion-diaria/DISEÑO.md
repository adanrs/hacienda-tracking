# Reporte Diario de Producción por lote — diseño y datos que faltan

> Estado (13-oct-2026): **implementado** con las dos fuentes (escaneo de etiquetas de deshuese + reporte de CIISA) y su conciliación. Ver §6. Las §2–§4 quedan como el análisis que llevó a la decisión.
> Este documento define el formato, de dónde sale cada campo y qué hay que capturar para poder construirlo sin inventar nada.
> Formato de referencia: [foto del reporte CIISA del 21/09/26](formato-ciisa-2026-09-21.jpg) · transcripción verificada: [`ejemplo-2026-09-21.json`](ejemplo-2026-09-21.json).

## 1. El formato de CIISA

**Encabezado**

| Campo | Ejemplo | Observación |
|---|---|---|
| Fecha de Producción | 21/09/26 | Día del deshuese |
| Num. Lote | 3 | Significado por confirmar (§5, R1) |
| Tipo Producción | TEMPISQUE | Probablemente la cuenta dueña del producto (bodega 107 «EQTB Tempisque»); por confirmar (R2) |
| Lote CC | 06 | Posición del animal en el deshuese del día. Es el n.º de 2 dígitos que va en las etiquetas |

**Detalle:** una fila por artículo, ordenada por código: `Artículo | Descripción | Peso | Unidad | Cajas`. En el ejemplo hay 29 filas, unidad siempre KGS.

**Pie:** `Total de Cajas por el Lote # <Num. Lote> | Libras <kg × 2.20462> | Kilos <Σ peso> | <Σ cajas>`. En el ejemplo: 705.08 lb, 319.82 kg y 34 cajas, y los tres totales cuadran con las filas.

**Tabla de aretes por posición.** Viene en el correo de CIISA, no en el reporte: `06→72ELF, 07→26FLB, 08→49NKB, 09→347FLH, 10→238FL2, 11→238FL1, 12→32ELV`. Es la llave que convierte el n.º de deshuese impreso en cajas y primales en un arete.

**Un reporte = un animal.** El ejemplo trae 2 cajas de Delmonico, 2 de chuck, 1 rabo y 1 osobuco, con 319.82 kg en total: eso es una sola canal. Lote CC 06 corresponde entonces al arete 72ELF. Coincide con la regla del diseño v10 «Lote CC = un canal = un arete» (`lotes_deshuese`).

## 2. Qué existe hoy en la app y qué falta

| Campo del reporte | Fuente actual | ¿Alcanza? |
|---|---|---|
| Fecha de producción | `deshuese.fecha` | Sí |
| Num. Lote | — | **No se captura** (y además no se sabe qué es) |
| Tipo producción | — | **No se captura** |
| Lote CC / posición | `deshuese.numero_lote` = `DES-AAAAMMDD-<sacrificio_id>`, UNIQUE global | **No.** No es el lote CC, y como es único en toda la tabla no puede guardar «06» dos días distintos |
| Artículo + Descripción | `primales.tipo_primal`: 9 categorías fijas (Lomo, Costilla, Pierna, Paleta, Pecho, Falda, Aguja, BCH, Otro), sin código | **No.** El reporte trae ~29 artículos CIISA con código (21231, 22229…). Las categorías de la app no se pueden convertir a esos códigos sin inventar el reparto |
| Peso | `primales.peso_kg` | Solo por categoría, no por artículo |
| Cajas | — | **No se captura.** Un primal registrado no equivale a una caja (en el ejemplo, Trimmings son 4 cajas) |
| Arete por posición | `animales.numero_trazabilidad` vía `deshuese.animal_id` | El arete sí está, pero **falta la posición** que lo une con las etiquetas |

Lo que **sí** está listo: el catálogo de artículos (PR #1) tiene los 29 códigos del ejemplo con su nombre, y el decodificador de etiquetas (este PR) extrae artículo, kg, fecha de deshuese y n.º de deshuese de cada caja de deshuese (primal).

Con los datos actuales, un «reporte» por categoría (Lomo, Costilla…) sin códigos, cajas ni posición **no** sería el mismo formato y llevaría a conciliar mal contra CIISA. Por eso no se construyó.

## 3. Qué hay que capturar (en orden de valor)

1. **Tabla posición → arete por fecha de deshuese.** Es lo que más rinde y lo primero que conviene capturar: con ella se resuelve el arete de toda caja y primal. Destino: `lotes_deshuese (fecha_deshuese, numero_lote, arete, animal_id, deshuese_id)` del diseño v10. Captura: a mano desde el correo de CIISA (son ~7 filas por día) o con la carga de documentos (`cargas_ciisa`, método `imagen_ia`/`manual`). Mientras v10 no exista, hay un atajo de bajo riesgo: agregar `deshuese.lote_cc SMALLINT NULL` con unicidad (fecha, lote_cc) validada en el backend. Luego el backfill de v10 lo pasa a `lotes_deshuese` (v10 §8, paso 3, ya prevé tomar el lote CC «que se digita desde el PDF de deshuese»).
2. **Líneas del reporte por artículo.** Hay dos caminos, que no se excluyen:
   - **A. Cargar el reporte de CIISA** como documento: `documentos_ciisa` con `tipo='DESHUESE'` y `numero_ciisa = <fecha>-<lote CC>`; líneas en `documentos_ciisa_lineas (articulo_codigo, unidades = cajas, kg, lote = lote CC, arete)`. El reporte en pantalla es la reimpresión de lo que dijo CIISA.
   - **B. Armarlo desde las etiquetas de deshuese escaneadas** (cada primal/caja de deshuese = 1 caja): `etiquetas` con `origen_etapa='deshuese'`, agrupadas por artículo. Así el reporte es **el nuestro**, y la diferencia contra A sale como conciliación (banda `deshuese`).
   - Recomendación: B como fuente del reporte y A para conciliar, que es el mismo patrón de TRE/ASE en v10. Si solo se puede uno, A es más barato (una carga por día) y B da trazabilidad caja por caja.
3. **Num. Lote y Tipo de producción**: dos columnas de texto en el encabezado del documento (`documentos_ciisa`) o en `lotes_deshuese`, cuando CIISA aclare qué son (R1, R2).

## 4. Cómo se construiría (cuando existan los datos)

**Filtro:** fecha de deshuese (obligatoria) y lote CC (opcional; sin él, un bloque por cada lote CC del día).

**Consulta (camino B, modelo v10):**
```sql
SELECT e.articulo_codigo            AS articulo,
       COALESCE(c.nombre, e.articulo_codigo) AS descripcion,
       ROUND(SUM(e.kg), 2)          AS peso,
       'KGS'                        AS unidad,
       COUNT(*)                     AS cajas
FROM etiquetas e
JOIN lotes_deshuese ld ON ld.id = e.lote_deshuese_id
LEFT JOIN catalogo_cortes c ON c.codigo = e.articulo_codigo
WHERE e.origen_etapa = 'deshuese'
  AND e.activo = 1
  AND ld.fecha_deshuese = ?
  AND ld.numero_lote = ?
GROUP BY e.articulo_codigo, c.nombre
ORDER BY e.articulo_codigo;

-- Tabla de aretes del día
SELECT LPAD(ld.numero_lote, 2, '0') AS posicion, ld.arete
FROM lotes_deshuese ld
WHERE ld.fecha_deshuese = ?
ORDER BY ld.numero_lote;
```
Parámetros siempre con `?`. Libras = `ROUND(kilos * 2.20462, 2)`, que con el ejemplo da exactamente 705.08.

**Pantalla** (menú Planta → «Reporte de producción»): filtros fecha + lote CC; encabezado de 4 campos; tabla con las 5 columnas; pie con los totales; tabla «Posición / Arete» al lado (en móvil, debajo); botón «Descargar Excel». Cuando no hay datos: «No hay deshuese registrado para esa fecha y lote. Revise la fecha o cargue el reporte de CIISA.»

**Excel** (mismo formato que CIISA, una hoja por lote CC): fila 1 título «REPORTE DIARIO DE PRODUCCION»; filas 3–5 encabezado (Fecha de Producción, Num. Lote / Tipo Producción, Lote CC); fila 7 títulos de columna; detalle; fila de pie «Total de Cajas por el Lote # n | Libras | Kilos | cajas»; tabla Posición/ARETE a la derecha (columnas H–I). Pesos con formato `#,##0.00`, códigos de artículo como texto. Con `exceljs` en el backend (nueva dependencia: obliga a reconstruir la imagen Docker). Prueba de aceptación: generar el reporte a partir de [`ejemplo-2026-09-21.json`](ejemplo-2026-09-21.json) y comparar totales (319.82 kg, 705.08 lb, 34 cajas).

## 5. Preguntas abiertas

| # | Pregunta | Para quién | Impacto |
|---|---|---|---|
| R1 | ¿Qué es **Num. Lote** (3) frente a **Lote CC** (06)? ¿Cuál de los dos va impreso en las etiquetas? Según el cliente es la posición, que corresponde al Lote CC | CIISA | Define la llave de `lotes_deshuese` |
| R2 | ¿**Tipo Producción** es siempre TEMPISQUE (cuenta EQTB Tempisque) o cambia por cliente o finca? | WC | Columna fija o dato por lote |
| R3 | ¿CIISA puede mandar el reporte y la tabla de aretes en Excel/CSV en vez de foto o PDF? | CIISA | Pasa la captura de manual/IA a carga directa (`excel_csv`) |
| R4 | «Cajas» de Trimmings (4) y Chuck (2): ¿cada caja lleva su etiqueta de deshuese con el mismo artículo? | CIISA | Confirma que contar etiquetas (camino B) da el mismo número que el reporte |

## 6. Implementación (13-oct-2026)

Decisión de Adán: el reporte se arma con **las dos fuentes** y su valor principal es **conciliarlas**.

**Modelo (atajo mínimo, aditivo, en `models/database.js`).** No se crean las tablas de v10 a medias: `lotes_deshuese` exige `canal_id NOT NULL` (y `canales` no existe), y `etiquetas`/`documentos_ciisa` traen columnas obligatorias que hoy no se capturan; un `CREATE TABLE IF NOT EXISTS` de v10 se saltaría en silencio contra una tabla parcial. Nombres propios, sin choque:

| Tabla | Qué guarda | Pasa en v10 a |
|---|---|---|
| `reporte_produccion` | Encabezado CIISA: fecha, lote CC (UNIQUE fecha+lote), Num. Lote, Tipo producción, origen (`excel_csv`/`manual`/`pegado`/`json`) | `documentos_ciisa` tipo `DESHUESE` |
| `reporte_produccion_lineas` | Artículo, descripción, kg, unidad, cajas (UNIQUE reporte+artículo) | `documentos_ciisa_lineas` |
| `lotes_cc_aretes` | Posición → arete por fecha (UNIQUE fecha+lote), animal y deshuese resueltos | `lotes_deshuese` |
| `reporte_produccion_escaneos` | Cada etiqueta de deshuese (caja/primal) escaneada: artículo, kg, fecha y lote impresos, JSON del decodificador | `etiquetas` con `origen_etapa='deshuese'` |

**Captura.** Pantalla Planta → «Reporte de producción», 4 pestañas: Reporte, Escanear etiquetas, Cargar reporte CIISA (Excel/CSV con plantilla descargable, o captura manual pegando filas), Aretes por posición. El importador **no guarda**: muestra una vista previa por lote con totales y errores, y se guarda con la misma validación que la captura manual (`lib/reporteProduccion.js → validarReporte`). Si se digitan los totales del pie, se exige que cuadren con las filas.

**Conciliación** (`conciliar`): por lote CC y artículo, kg y cajas de CIISA contra lo escaneado. Estados: *cuadra* (cajas iguales y |Δkg| ≤ 0.01), *diferencia*, *no escaneado*, *no está en CIISA*. Diferencias = escaneado − CIISA.

**Excel** (`lib/reporteProduccionExcel.js`, exceljs): una hoja por lote CC con el formato CIISA en A–E, conciliación en G–K y la tabla Posición/ARETE en M–N.

**Escaneo.** Solo cuentan caja master y primal (traen fecha de deshuese y lote CC). El paquete se rechaza. Una etiqueta ambigua (25 dígitos) pide «caja o primal». Una caja idéntica a otra ya escaneada se bloquea salvo que el operador confirme «es otra caja» (`copia` > 1); un primal repetido nunca, porque su Box es único.

**Pendiente de CIISA / cliente**: R1–R4 de §5 siguen abiertas; además la tolerancia de negocio de la conciliación (hoy 0.01 kg por artículo).
