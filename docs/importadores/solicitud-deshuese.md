# Solicitud de deshuese: plantilla real de la planta

Fuente analizada: `Solicitud_de_Deshuese_y_Porcionado.xlsx` (Juan Carlos, 05-nov-2026; 31 MB por las
fotos), 39 hojas. La hoja más reciente, **«Deshuese 160524»** (16/05/24), es la base de la plantilla
`backend/plantillas/solicitud-deshuese.xlsx`, generada con `backend/scripts/generar-plantilla-solicitud.py`
(se borran las otras hojas y los datos de ejemplo de las canales; formato, celdas combinadas, anchos y
todas las fórmulas se conservan).

## Hojas del libro

| Hojas | Qué son |
|---|---|
| `Deshuese ddmmaa` / `Deshuses ddmmaa` (35) | Una solicitud por día de sacrificio. El nombre trae la fecha, a veces sin ceros (`Deshuses 8223` = 08/02/23) y con espacios de más. |
| `Laboratorio 221021`, `Reporte Produccion 221021` | Resultados de una corrida (laboratorio y producción). No se importan. |
| `Cortes y BMS` | Referencia de músculos NAMP por corte (costillas, chuck). No se importa. |
| `SKU y Nombre` | Lista SKU (266xx) → nombre comercial. Útil para el importador del catálogo. |
| `Deshuseses y Porcionados` | La versión más vieja (2021). |

## Mapeo de la hoja «Deshuese ddmmaa»

**Canales (5 por hoja):** columnas **G, I, K, M, O** (fila 2 = «Canal # n»). Las columnas **H, J, L, N, P**
son de cálculo (kg estimados). En hojas viejas (2022) las canales van en F, H, J, L, N y la F puede decir
«5Estrellas» en vez de «Canal #».

| Fila | Columna B | Qué escribe la app | De dónde sale |
|---|---|---|---|
| 2 | Cantidad de canales | «Canal # n» (renumerado en hojas 2, 3…) | orden en la solicitud |
| 3 | Arete | arete | `animales.numero_trazabilidad` |
| 4 | Sexo | M / H | `animales.sexo` |
| 5 | Padre | n.º del padre | `animales.padre_numero` (Ganadero SG) |
| 6 | Peso en Pie | peso de salida de la finca | último `transporte.peso_pie_finca` (guía) |
| 7 | Peso Pie Planta | peso pie en planta | `sacrificios.peso_vivo` |
| 8 | Peso canal | peso canal | frío si existe, si no caliente |
| 9 | Cosesecutivo Mes Sacrificio | n.º de canal CIISA | `sacrificios.numero_canal` |
| 10 | Lote de Deshuese | (vacío: lo llena la planta) | — |
| 11 | Peso Deshuese | **fórmula** `=G8*84%` (se conserva) | — |
| 12 | Marble Score 12-13 Costilla Deshuese | marmoleo | `sacrificios.marmoleo` (DMs AUS-MEAT 0–9) |
| 13–15 | Merma transporte, Rendimiento matanza, Rendimiento deshuese | **fórmulas** (se conservan) | — |
| 17 | Codigo · NAMP · Guia-INA · Corte · Canal… · Observaciones | títulos | — |
| 18–71 | un corte por fila: código CIISA en **B**, NAMP en C, Guía INA en D, nombre en **E**, % de referencia en F | medias **0 / 1 / 2** en G, I, K, M, O; observación en **Q** | `solicitud_lineas` |
| 52–68 | BCH fresco, molida 75/25 y 65/35, chorizos, hamburguesas, trim | **fórmulas** de proceso (se conservan; la app no las llena) | — |
| 80–96 | Rendimientos de producto terminado y cuadros de Pearson (molida y ZAMU) | parámetros y fórmulas (se conservan) | — |

Leyenda a la derecha (U1:Y3): **1** = una media canal, **2** = dos medias canales, **FT** = n.º de ficha
técnica. El bloque U7:AL71 («Paquetería EQTBL Reciprocity») lista, por corte, el producto porcionado
(nombre, NAMP, código FT 266xx) y su reparto por canal.

Reglas al llenar:
- Una celda de canal con fórmula (p. ej. `=2-G18`: lo que no va a Cowboy va a Delmonico) se reemplaza por
  el número de la solicitud **solo** si la solicitud trae ese corte; si no, la fórmula queda.
- Más de 5 canales → se copian hojas «Deshuese ddmmaa (2)», «(3)»…
- Cortes de la solicitud que no están en la plantilla → hoja «Cortes adicionales».
- El libro se marca para recalcular al abrir (exceljs guarda las fórmulas sin resultado).

## Importar solicitudes históricas

Formato `solicitud-deshuese-excel` (pantalla Solicitud de deshuese → Lista). Cada hoja «Deshuese…» es una
fila de la vista previa: fecha desde el nombre (si admite dos lecturas, se pregunta), canales por la fila
«Canal #», datos por la etiqueta de la columna B, cortes debajo de «Codigo» hasta el bloque de BCH. Cada
canal se liga a un sacrificio registrado del día por n.º de canal o, si no, por arete; las canales sin
sacrificio se avisan y no se importan. Filas sin código (Grasa rinodada, Trim, Cachetes, Fémur, Lengua…)
o con un código fuera del catálogo van al **99 «pendiente de codificar»** con su nombre. Quedan en estado
«deshuesada» y no se pisa una solicitud que ya exista para la fecha.

## Preguntas para el dueño (lo que no se pudo interpretar)

1. **Fila 12 «Marble Score 12-13 Costilla Deshuese»**: los valores (3.1, 5.3, 12.7) no son AUS-MEAT 0–9.
   ¿Es BMS 1–12 medido en la costilla al deshuesar? La app escribe ahí el AUS-MEAT de la cámara: ¿está bien
   o debe ir en otra fila?
2. **Código 22101 repetido** (fila 44 «Lomito» y fila 46 «Lomito (Cabeza)»): la app escribe las mismas medias
   en las dos. ¿La cabeza de lomito necesita su propio código?
3. **Columna F (%)** (0.044, 0.05, 0.007…): ¿es el rendimiento esperado de cada corte sobre el peso de deshuese?
   La fórmula de BCH (fila 52) lo usa: `=G11*(41%+F28+F27)`. ¿De dónde sale el 41 %?
4. **Bloque de proceso (filas 52–68)**: molida 75/25, 65/35, chorizos y hamburguesas por canal (0/1 = sí/no).
   ¿Esto también se debe pedir desde la app (hoy no) o lo sigue armando la planta?
5. **Bloque «Paquetería EQTBL Reciprocity» (U7:AL71)**: el reparto del porcionado por canal y las fórmulas
   `W3 = 413 + (today() − V3) × 0.6` (peso proyectado de tres aretes de ejemplo). ¿Siguen en uso?
6. **«Cosesecutivo Mes Sacrificio»** (fila 9): ¿es el mismo n.º de canal que manda CIISA en el correo de sacrificio
   (5256…) o un consecutivo distinto del mes?
7. Hojas con nombres cortos que admiten dos fechas (p. ej. «11123»): ¿la planta pone siempre día-mes-año?
