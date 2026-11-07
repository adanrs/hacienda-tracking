# Auditoría UX/UI — Hacienda Tempisque (ganaderia.kiwidinamico.com)

**Fecha:** 7 de noviembre de 2026 · **Base:** `origin/master` @ `12ccfcc` · **Rama de arreglos:** `feat/pulido-ux-general`

## Cómo se evaluó

- **App real, local**, con base MySQL propia (`ht_ux`, en el contenedor `ht-mysql-test`) cargada con `seed.js` + `seed:prueba` (datos de prueba: 20 animales, potreros, flujo PRUEBA de planta). Sin credenciales de producción.
- **Recorrido automatizado con Playwright (Chromium)** de las 26 pantallas del menú a **1366 px** y **390 px** (celular, `hasTouch`), con medición en cada una de: desborde horizontal, controles de menos de 44 px de alto, campos sin etiqueta y **axe-core** (reglas WCAG 2 A/AA). Métricas en `capturas/metricas-antes.json` y `capturas/metricas-despues.json`.
- **Lectura de código** de `index.css`, `App.jsx`, `components/ui/*` y de las páginas, con el detector de **impeccable** (`impeccable detect frontend/src`).
- Marcos usados: impeccable *audit* (5 dimensiones), Intent *evaluate* (heurísticas de Nielsen, patrones oscuros, estados), Web Interface Guidelines (Vercel) y la referencia rápida de ui-ux-pro-max.
- Contexto: la app ya tuvo una pasada de UX el 09-oct (ver `docs/ux/auditoria-2026-10-09.md` en el repo) y tiene un sistema de diseño en `frontend/DESIGN.md`. Esta auditoría parte de ahí: busca lo que quedó afuera del sistema y lo que se rompió después.

**Severidad.** P0 = la pantalla muestra información falsa o impide la tarea. P1 = barrera de accesibilidad (WCAG AA), pérdida de datos posible o fricción seria en celular/tableta. P2 = inconsistencia o molestia con alternativa. P3 = cosmético.

## Puntaje

| Dimensión (impeccable audit) | Antes | Hallazgo principal |
|---|---:|---|
| Accesibilidad | 2/4 | 138 botones de ícono sin nombre accesible; ~190 `<label>` no asociados a su campo; 30 modales sin `role="dialog"`, sin Escape ni foco atrapado |
| Rendimiento | 3/4 | Sin problemas serios; `transition: width` en `CowIcon` |
| Responsive | 2/4 | Maduración se desborda 269 px a 390 px; tarjetas-fila largas sin jerarquía; filtros apilados empujan los datos fuera de la primera pantalla |
| Tematización | 2/4 | Hay tokens buenos, pero 9 páginas pintan con hex sueltos (Maduración 21, Paquetería 20, Dashboard 10, AnimalDetalle 9, Potreros 8…) |
| Integridad de implementación | 2/4 | Maduración, Ficha del animal y el Resumen quedaron fuera del sistema; dos bugs de datos en la ficha |
| **Total** | **11/20** | Aceptable: base sólida, trabajo pendiente en las pantallas viejas |

Salud UX (Intent evaluate): **64/100**. Patrones oscuros: **limpio** (no hay urgencias falsas, consentimientos premarcados ni confirmaciones manipuladoras; las eliminaciones piden confirmación propia).

## Los 10 hallazgos principales

1. **[P0] La línea de tiempo del animal nunca se muestra.** `AnimalDetalle.jsx:24` guarda la respuesta de `/animales/:id/timeline` (un objeto `{ animal, timeline }`) como si fuera una lista: la pestaña dice «Línea de tiempo ()» y el contenido «Sin eventos en el timeline» aunque el animal tenga pesajes, salud y planta. Es la vista de trazabilidad de punta a punta del animal y miente. → **Arreglado.**
2. **[P1] La curva de peso dibuja mal la escala.** `AnimalDetalle.jsx:39` pasa `peso_kg` como texto (MySQL devuelve DECIMAL como string); recharts arma el eje 0–100 kg y la línea se sale del gráfico (216 kg queda fuera). → **Arreglado** (convertir a número para el gráfico).
3. **[P1] 138 botones de ícono sin nombre accesible** (axe `button-name`): eliminar/editar en Pesajes, Salud, Potreros, Bodegas, Transporte, Sacrificio, Usuarios, Reproducción, Porcionado, Paquetería. Un lector de pantalla dice «botón» y nada más; en tableta no hay tooltip. Además pintan la papelera con `color="#dc2626"` suelto. → **Arreglado** (`aria-label`/`title` con el registro y clase `peligro`).
4. **[P1] Formularios: ~190 etiquetas no asociadas a su campo.** El patrón `<label>Peso (kg) *</label><input>` sin `htmlFor` hace que tocar la etiqueta no enfoque el campo (objetivo táctil más chico con guantes) y que el lector de pantalla anuncie «campo de edición» sin nombre. → **Arreglado de forma global** (`useFormulariosAccesibles`: asocia etiqueta y campo, marca `aria-required`).
5. **[P1] 30 modales «a mano» sin semántica de diálogo, sin Escape y que se cierran con un toque fuera.** Solo `ui/Modal.jsx` (Inventario planta) lo hace bien. En las demás pantallas, un toque accidental en el fondo con el formulario a medio llenar borra lo escrito (riesgo real en tableta con guantes). → **Arreglado de forma global**: todos los `.modal` reciben `role="dialog"`, `aria-modal`, título asociado, foco al primer campo, Tab atrapado, Escape para cerrar, y el toque en el fondo **ya no cierra** si la ventana tiene un formulario.
6. **[P1] Maduración quedó fuera del sistema y se desborda en celular.** 269 px de desborde a 390 px (el botón «Nuevo registro» queda cortado), grilla fija de 4 columnas, 26 estilos en línea y 21 colores sueltos, `select` sin etiqueta (axe `select-name`), títulos sin tilde («Maduracion», «Codigo», «Dias»), ✓/✗ como único texto de «cumple». → **Arreglado** (clases y tokens, grilla adaptable, etiquetas, tildes, «Cumple/No cumple»).
7. **[P1] Pantallas sin estado de carga ni de error.** Pesajes, Salud, Movimientos, Reproducción, Potreros, Transporte, Sacrificio, Bodegas, Devoluciones, Usuarios y Maduración muestran «Sin registros» mientras cargan, y si cae la red de planta solo sale un aviso efímero y la tabla dice que no hay datos. → **Arreglado** con `useCarga` + `FilaEstado` (cargando / error con «Reintentar» / vacío útil).
8. **[P1] Las tablas en celular son tarjetas largas sin jerarquía.** Cada fila pasa a 8–10 renglones iguales de 48 px; el dato que identifica la fila (arete, código, fecha) no se distingue, la etiqueta «Acciones» ocupa un renglón, y en Animales el primer renglón es solo el ícono de la vaca. → **Arreglado en CSS**: primer dato como título de la tarjeta, renglones más compactos, acciones alineadas sin etiqueta, ícono decorativo oculto en celular.
9. **[P2] Resumen general sin jerarquía.** 11 KPI iguales en tres filas, mayúsculas mezcladas («Animales Activos» / «Órdenes de salida pendientes»), alertas marcadas con borde lateral grueso y hex sueltos (`#7f1d1d`, `#dc2626`), y el gráfico de potreros omite etiquetas del eje («Corral Principal» no aparece). → **Arreglado**: KPI agrupados por etapa (Finca / Planta y bodega) con encabezado, mayúscula de oración, estado de alerta con clase y texto, todas las etiquetas del eje.
10. **[P2] Celular: filtros y botones empujan los datos.** En Animales hay 4 filtros a ancho completo (≈ 230 px) antes del primer animal; los botones del encabezado quedan con anchos dispares. Los `type="number"` no piden teclado numérico en iPhone (`inputmode`). → **Arreglado**: búsqueda a ancho completo y selects de a dos, acciones del encabezado repartidas, `inputmode` decimal/numérico automático en campos numéricos no negativos.

## Hallazgos completos

### P0
| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| P0-1 | Línea de tiempo del animal siempre vacía (respuesta objeto tratada como lista) | `AnimalDetalle.jsx:24,96,153` | Arreglado |

### P1
| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| P1-1 | Curva de peso con eje equivocado (pesos como texto) | `AnimalDetalle.jsx:39,82-91` | Arreglado |
| P1-2 | Botones de ícono sin nombre accesible (138 nodos en axe) | Pesajes, Salud, Potreros, Bodegas, Transporte, Sacrificio, Usuarios, Reproducción, Porcionado, Paquetería, Cortes, Deshuese | Arreglado |
| P1-3 | ~190 `<label>` sin `htmlFor`; campos sin nombre accesible | Formularios de todas las pantallas | Arreglado (global) |
| P1-4 | 30 modales sin `role="dialog"`, sin Escape ni foco atrapado; el toque fuera borra el formulario | Animales, Pesajes, Salud, Bodegas, Cajas, Custodia, Órdenes… | Arreglado (global) |
| P1-5 | Maduración: desborde de 269 px a 390 px, grilla fija de 4 columnas | `Maduracion.jsx:219-237,322-333` | Arreglado |
| P1-6 | Maduración: `select` sin etiqueta (axe `select-name`) | `Maduracion.jsx:329` | Arreglado |
| P1-7 | Ficha del animal: contraste insuficiente (axe `color-contrast`, 4 nodos: verdes `#16a34a` sobre `#f0fdf4`, gris `#6b7280` en `CowWeightIndicator`) | `AnimalDetalle.jsx:56-76`, `CowIcon.jsx` | Arreglado |
| P1-8 | Sin estado de carga/error en 11 pantallas de lista | Pesajes, Salud, Movimientos, Reproducción, Potreros, Transporte, Sacrificio, Bodegas, Devoluciones, Usuarios, Maduración | Arreglado |
| P1-9 | Eliminar en Pesajes/Salud sin manejo de error: si falla, no pasa nada visible | `Pesajes.jsx:29-33`, `Salud.jsx` | Arreglado (aviso de error) |
| P1-10 | Tarjetas-fila en celular sin título ni jerarquía; renglón «Acciones» vacío de sentido | `index.css` (≤ 819 px) | Arreglado |
| P1-11 | Campo de arete de Marmoleo de 32 px de alto (objetivo táctil) | `.imp-input-arete` | Arreglado (44 px, solo CSS) |
| P1-12 | Casillas de selección de 13 px en Inventario planta (tabla) | `InventarioPlanta.jsx` (solo CSS) | Arreglado (22 px + área táctil, solo CSS) |
| P1-13 | Enlaces de texto dentro de tablas de 20 px de alto en celular | Todas las tablas | Arreglado (área táctil de 44 px con `pointer: coarse`) |
| P1-14 | Buscador de animal (usado en Pesajes, Salud, Movimientos, Reproducción, Transporte, Sacrificio, Animales): opciones `<div onClick>` de ~34 px, sin teclado, sin rol de lista, colores sueltos | `components/AnimalSearch.jsx` | Arreglado: combobox con flechas + Enter, opciones de 44 px, X para limpiar con nombre |
| P1-15 | Pestañas de Salud hechas con `<div onClick>`: no se pueden usar con teclado ni las anuncia el lector | `Salud.jsx:47-50` | Arreglado (botones con `role="tab"`) |
| P1-16 | Inventario planta: 3 campos sin nombre accesible | `InventarioPlanta.jsx` | Pendiente: archivo reservado a cambios de clases en esta pasada (hay otro trabajo en paralelo) |

### P2
| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| P2-1 | Resumen: 11 KPI planos sin agrupar, Title Case mezclado, borde lateral grueso para alertas | `Dashboard.jsx` | Arreglado |
| P2-2 | Gráfico de potreros omite etiquetas del eje X | `Dashboard.jsx` | Arreglado |
| P2-3 | Colores sueltos en páginas (≈ 100 hex) | Maduración, Dashboard, AnimalDetalle, Potreros, Bodegas, Sacrificio, Porcionado, Deshuese, Paquetería, AnimalSearch | Parcial: Maduración, Dashboard, AnimalDetalle, Potreros, Bodegas y papeleras de todas las páginas. Pendiente: Paquetería (20), Sacrificio, Porcionado, Deshuese |
| P2-4 | Filtros apilados a ancho completo en celular | `.filter-bar` | Arreglado |
| P2-5 | Encabezado de página en celular con botones de ancho dispar | `.page-header` | Arreglado |
| P2-6 | `type="number"` sin `inputmode`: en iPhone no sale el teclado numérico | ~40 campos | Arreglado para campos con `min ≥ 0`; los que admiten negativos (temperatura) quedan con el teclado por defecto a propósito, porque el teclado decimal de iOS no tiene signo menos |
| P2-7 | Textos sin tilde en ficha y maduración («Informacion General», «Ubicacion y Genealogia», «Crias», «Descripcion», «Proxima») | `AnimalDetalle.jsx`, `Maduracion.jsx` | Arreglado |
| P2-8 | Títulos de tarjeta y KPI en Title Case («Curva de Peso», «Nuevo Pesaje», «Pesajes Recientes») contra la regla de mayúscula de oración de DESIGN.md | Varias | Parcial (Resumen, ficha, Pesajes, Maduración) |
| P2-9 | Identidad tipográfica genérica: todo en la fuente del sistema, sin rasgo propio de la marca | `index.css` | Arreglado: serif de sistema (Palatino / Iowan / Georgia, sin fuentes web) para la marca, títulos de página y de sección |
| P2-10 | Botones de guardar no se deshabilitan mientras se envía (doble envío posible con red lenta) | Formularios de finca y planta | Pendiente: requiere estado por pantalla |
| P2-11 | Paquetería (560 líneas, 42 estilos en línea) fuera del sistema | `Paqueteria.jsx` | Pendiente |
| P2-12 | Placeholders y opciones con «...» en vez de «…» | Custodia, Deshuese, Devoluciones, Movimientos, Porcionado, Paquetería, AnimalSearch | Arreglado en las pantallas tocadas |
| P2-13 | Filtros y pestañas no quedan en la URL (volver atrás pierde el filtro) | Animales, Cajas, Reporte de producción | Pendiente |

### P3
| # | Hallazgo | Dónde | Estado |
|---|---|---|---|
| P3-1 | Borde lateral grueso (4–5 px) en avisos, `aviso-inline`, `imp-guia` y KPI del Resumen (patrón señalado por el detector de impeccable) | `index.css:637,1047,1064`, `Dashboard.jsx:132` | Arreglado: borde completo de 1 px en el tono del estado; el ícono y el texto mandan |
| P3-2 | `transition: width` en la barra de peso | `CowIcon.jsx:47` | Arreglado (`transform: scaleX`) |
| P3-3 | `prefers-reduced-motion` apaga todo con `!important` (también el giro del spinner, que es la única señal de «cargando») | `index.css:174` | Arreglado: el spinner gira lento en vez de quedar quieto |
| P3-4 | En celular el título de la pantalla aparece dos veces (barra superior y `h2`) | Layout | Pendiente (decisión de diseño menor) |
| P3-5 | Emoji de vaca coloreado azul/rosa por sexo en Animales | `Animales.jsx` | Pendiente (se oculta en celular) |

## Resultado medido (después de la rama)

Mismo recorrido de Playwright + axe-core sobre las 26 pantallas (`capturas/metricas-despues.json`):

| Métrica | Antes | Después |
|---|---:|---:|
| Violaciones axe WCAG A/AA (nodos, 1366 px) | 143 (button-name 138, color-contrast 4, select-name 1) | 0 |
| Violaciones axe WCAG A/AA (nodos, 390 px) | 143 | 0 |
| Pantallas con desborde horizontal a 390 px | 1 (Maduración, 269 px) | 0 |
| Controles < 44 px a 390 px (todas las pantallas) | 164 | 4 (casillas de 22 px de Inventario planta, dentro de celda de 44 px) |
| Campos sin etiqueta | 4 | 3 (Inventario planta, pendiente) |

A 1366 px quedan botones de ícono de 40 px y enlaces de texto en tablas: es lo previsto por DESIGN.md para puntero fino (con `pointer: coarse` suben a 44 px).

## Recorrido por tareas (cognitive walkthrough)

- **Registrar un pesaje en el potrero (celular).** Menú → Pesajes → «Nuevo pesaje» → buscar animal → peso → Guardar. Antes: el campo de peso abría el teclado completo en iPhone, tocar «Peso (kg)» no enfocaba el campo, y un toque fuera del modal borraba lo escrito. Después: teclado decimal, etiqueta tocable, el fondo no cierra. **Falla → Pasa.**
- **Revisar la historia de un animal (escritorio).** Animales → arete → Línea de tiempo. Antes: «Sin eventos» (falso). Después: eventos reales de finca y planta. **Falla → Pasa.**
- **Anotar la temperatura de la cámara de maduración (celular).** Antes: hay que desplazarse de lado para ver «Nuevo registro»; el filtro de bodega no tiene nombre. Después: todo en ancho, filtro etiquetado. **Vacilación → Pasa.**
- **Pistolear cajas en Cajas y etiquetas (tableta).** Sin cambios: el escáner de la pasada anterior ya cumple (campo de 56 px, respuesta grande con ícono, color y texto, foco que vuelve solo). **Pasa.**

## Lo que funciona y hay que cuidar

- Sistema de tokens y DESIGN.md claros; foco visible carmesí; salto al contenido; menú agrupado por etapa con migas.
- Escáner (`ui/Escaner.jsx`), confirmaciones propias (`confirmar`), avisos con `aria-live`, `FilaEstado` para cargando/error/vacío.
- Tablas que pasan a tarjetas sin tocar cada página (`useEtiquetasTablas`), cifras tabulares alineadas a la derecha.
- Cero desborde horizontal en 25 de 26 pantallas a 390 px.

## Capturas

En el repo va una selección (`capturas/`: Resumen, Animales, ficha del animal, Maduración, Potreros, Transporte, Pesajes y la ventana de nuevo pesaje). El juego completo (26 pantallas + login + menú abierto, a 1366 y 390 px, con `metricas-antes.json` y `metricas-despues.json`) quedó en `D:/Claude-entregas/wagyu/ganaderia-ux-2026-11-07/capturas/`.
