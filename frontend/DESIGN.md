# Sistema de diseño — Trazabilidad Hacienda Tempisque

Herramienta de trabajo diaria: se usa en escritorio, en tablet en planta (a veces con guantes y
prisa) y en celular en finca. Por eso manda la **claridad y la densidad bien manejada** por encima
de la decoración. La identidad es la de **Hacienda Tempisque**, sobria: negro y blanco, con carmesí como
único acento.

## Marca

- La app de ganadería se llama **Hacienda Tempisque** (decisión del 06-nov-2026): login, menú,
  pestaña del navegador, encabezados impresos y textos que genera la app.
- **Wagyu Cross** es solo la marca comercial de la tienda (demo.wagyucross.com). Su nombre aparece
  en la app únicamente cuando se habla de la tienda como destino o en datos de negocio (bodega
  WC-01, empresa propietaria `WAGYU_CROSS`, productos Wagyu), nunca como identidad de la app.
- Logo: todavía no hay logo de Hacienda Tempisque. Mientras tanto se usa el wordmark tipográfico
  «Hacienda Tempisque» con el ícono `Beef` de lucide (login y menú). Cuando llegue el logo, va en
  `public/` y reemplaza al ícono en `Login.jsx` y en el encabezado del menú de `App.jsx`.

Todo vive en `src/index.css`. Las pantallas usan clases (`.btn`, `.card`, `.badge-green`…) y
tokens (`var(--text)`); **no se escriben colores sueltos en las páginas**. Si hace falta un valor
nuevo, primero se agrega como token aquí y en `:root`.

## Principios

1. **El color va en los datos y en lo que hay que hacer, no en el marco.** El carmesí marca dónde
   estoy (menú activo, pestaña activa), los enlaces, el foco y el dato principal de un gráfico.
   La acción primaria va en tinta (botón negro).
2. **Superficies planas.** Tarjetas blancas con borde de 1 px sobre gris neutro. Sombra solo en lo
   que flota: modales, cajón del menú, avisos.
3. **Nada depende solo del color.** Badges con texto, avisos con ícono + texto, menú activo con
   fondo + barra + negrita.
4. **Objetivos táctiles de 44 px como mínimo** (48 px en pantallas táctiles) y texto base de 16 px.
5. **Estados honestos y en su lugar.** Cargando, vacío y error viven dentro del bloque que los
   produce (`Estados.jsx`), nunca como pantalla completa. Un cero se imprime como `0`; un dato
   faltante, como `-`.

## Tokens

### Color

| Token | Valor | Uso |
| --- | --- | --- |
| `--marca` | `#b8184a` | Carmesí de la marca. Menú/pestaña activos, enlaces, foco, dato principal de gráficos. 6.3:1 sobre blanco. |
| `--marca-hover` / `--marca-suave` | `#94123b` / `#fbe9ef` | Hover del acento; selección de texto. |
| `--acento` | `#161616` | Acción primaria (`.btn-primary`), avatar. Se llama «acento» por compatibilidad: lo usan muchas pantallas. |
| `--bg` | `#f3f3f1` | Fondo de la app (gris neutro, no crema). |
| `--bg-card` | `#ffffff` | Tarjetas, modales, campos. |
| `--bg-sutil` / `--bg-hover` / `--bg-cebra` | `#f8f8f6` / `#ededea` / `#fafaf8` | Fondos internos, hover de fila, filas pares. |
| `--text` | `#161616` | Texto principal. |
| `--text-secondary` | `#474745` | Etiquetas de tabla, descripciones. |
| `--text-terciario` | `#5f5f5c` | Metadatos, placeholders. ≥ 5.5:1 sobre `--bg`. |
| `--border` / `--border-regla` / `--border-fuerte` | `#e0e0dc` / `#ececea` / `#8e8e89` | Borde de superficies / reglas entre filas / borde de controles (≥ 3:1, WCAG 1.4.11). |
| `--ok`, `--error`, `--alerta`, `--info` (+ `-suave`, `-fuerte`) | ver `:root` | Estados. Siempre en par pálido (fondo `-suave`, texto oscuro del mismo tono). |

El rojo de error (`#b42318`) es más anaranjado que el carmesí de marca para que no se confundan;
igual, todo error lleva ícono o texto.

### Tipografía

Fuente del sistema (`system-ui`: Segoe UI en Windows, Roboto en Android, SF en iPad). No se cargan
fuentes web: la red en planta es irregular y la app tiene que pintar al instante.

**Voz de la marca (`--fuente-titulos`, nov-2026):** serif clásica *del sistema* (Iowan Old Style en
iPad/iPhone, Palatino Linotype en Windows, Georgia/Noto Serif en Android). Solo para el wordmark
«Hacienda Tempisque», el título de cada pantalla (`.page-header h2`) y los títulos de sección
(`.seccion-titulo`). Da el aire de hacienda sin descargar nada. Datos, campos, botones y tablas
siguen en la sans del sistema.

| Token | Tamaño | Uso |
| --- | --- | --- |
| `--texto-xs` | 13 px | Cabeceras de tabla, badges, metadatos, migas. |
| `--texto-sm` | 15 px | Celdas, botones, menú. |
| `--texto-base` | 16 px | Cuerpo y campos (16 px evita el zoom automático de iOS). |
| `--texto-lg` | 18 px | Títulos de tarjeta. |
| `--texto-xl` | 22 px | Títulos de modal; título de página en tablet/celular. |
| `--texto-2xl` | 26 px | Título de página y valores KPI. |

Todo número en tabla o KPI usa cifras tabulares (`font-variant-numeric: tabular-nums`). Mayúscula
de oración en todo: nada de etiquetas en MAYÚSCULAS espaciadas.

### Espacio, radios, sombras, controles

- Escala de 4 px: `--esp-1` (4) … `--esp-10` (40).
- Radios: `--radius-control` 6 px (botones, campos), `--radius` 8 px (tarjetas), `--radius-lg`
  10 px (modales), `--radius-pill` para badges.
- Sombras: `--shadow-flota` (avisos) y `--shadow-lg` (modales, cajón). `--shadow` es `none`: las
  tarjetas en reposo no llevan sombra.
- Controles: `--control-alto` 44 px (48 px con `pointer: coarse`), `--toque-min` 44 px,
  `--fila-alto` 48 px.
- Movimiento: `--dur-rapida` 120 ms, `--dur` 200 ms, `--curva`. Solo `transform`/`opacity` en
  animaciones; todo se apaga con `prefers-reduced-motion`.

## Componentes

| Componente | Dónde | Notas |
| --- | --- | --- |
| Botón | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-danger`, tamaños `.btn-sm` / `.btn-lg`; `ui/Boton.jsx` | Un solo primario por pantalla. `cargando` deshabilita y muestra spinner. |
| Botón de ícono | `.btn-icon` (+ `.peligro`, `.ok`) | 40 px en escritorio, 44 px táctil. Siempre con `aria-label` o `title`. |
| Campo | `.form-group` + `label`; `ui/Campo.jsx` | Label arriba, ayuda y error debajo del campo (`aria-invalid`, `aria-describedby`). Error en rojo con ícono. |
| Filtros | `.filter-bar` | Búsqueda + selects. En tablet se reparten en filas. |
| Tabla | `.card > .table-container > table` | Cabecera pegajosa en escritorio, cebra sutil, reglas finas, números a la derecha. Bajo 820 px cada fila pasa a tarjeta (2 columnas entre 600 y 819 px). |
| Columna numérica | `.num` en `th`/`td` | `useEtiquetasTablas` la pone sola cuando toda la columna son cifras («179.00 kg», «55.11%»). Una página puede ponerla a mano. |
| Tarjeta | `.card`, `.card-header` | Borde 1 px, sin sombra. |
| KPI | `.stats-grid > .stat-card` | El número manda; el ícono es gris y chico. Las clases `.green/.blue/…` de `.stat-icon` ya no pintan. |
| Badge de estado | `.badge` + `.badge-green/red/yellow/blue/gray/purple/orange` | Par pálido con borde. La primera letra se capitaliza sola («activo» → «Activo»). |
| Pestañas | `.tabs > .tab.active` | Subrayado carmesí + negrita. |
| Modal | `.modal-overlay > .modal` (+ `.modal-header`, `.modal-actions`); `ui/Modal.jsx` para pantallas nuevas | Encabezado y pie de acciones pegajosos en formularios largos. `Modal.jsx` maneja foco, Escape y Tab. |
| Confirmación | `ui/confirmar.jsx` | Reemplaza `window.confirm`; foco en «Cancelar» si es peligrosa. |
| Avisos (toasts) | `ui/avisos.jsx` | Abajo a la derecha (ancho completo en celular), borde izquierdo por tipo, `aria-live`. |
| Estados | `ui/Estados.jsx`: `Cargando`, `EstadoVacio`, `EstadoError`, `FilaEstado` | Dentro del bloque; el error trae «Reintentar». |
| Paginación | `ui/Paginacion.jsx` | «21–40 de 312 animales» + Anterior/Siguiente de 44 px. |
| Encabezado de página | `.page-header` con `h2` + acción primaria; migas en el layout (`.migas`) | Las migas («Planta / Sacrificio») se muestran en escritorio; en tablet/celular la barra superior dice etapa y pantalla. |
| Escáner | `ui/Escaner.jsx` | Campo de 56 px, respuesta grande con color + ícono + texto. |
| Sección | `section.seccion > h3.seccion-titulo` | Agrupa bloques de una pantalla larga (Resumen: Finca / Planta y bodega / Hato). Serif, regla fina debajo. |
| KPI enlazado | `Link.stat-card` (+ `.alerta` y `.stat-aviso`) | La alerta pinta borde y fondo pálido de error **y** agrega una línea de texto («Revisar hoy»). Sin bordes laterales gruesos. |
| Fichas de catálogo | `.fichas > .card` con `.ficha-encabezado`, `.ficha-acciones`, `.cifras`, `.barra` | Potreros y Bodegas. La barra se escala con `transform: scaleX()`. |
| Pares dato/valor | `dl.ficha-datos` | Ficha del animal. |
| Banner | `.banner` + `.info` / `.ok` / `.error` / `.alerta` / `.critico`, con `.chips > .chip` | `.critico` (fondo rojo pleno) solo para primales olvidados. |
| Buscador de animal | `components/AnimalSearch.jsx` | Combobox accesible: flechas + Enter, opciones de 44 px, X para limpiar. |
| Carga de pantalla | `useEstadoCarga()` de `ui/Estados.jsx` + `FilaEstado` | `const [carga, seguir] = useEstadoCarga(); const load = () => seguir(api.getX().then(setX));` |
| Accesibilidad global | `ui/useAccesibilidadGlobal.js` (montado en `App.jsx`) | Asocia `<label>` y campo en `.form-group`, pone `inputmode` en numéricos no negativos, nombra casillas de tablas, y da a los `.modal` hechos a mano `role="dialog"`, foco, Tab atrapado y Escape; el toque en el fondo no cierra una ventana con formulario. |

## Navegación

- Escritorio (≥ 1024 px): barra lateral blanca de 256 px, grupos por etapa del producto
  (Finca → Planta → Bodega y despacho). Ítem activo: fondo gris, barra carmesí a la izquierda,
  ícono carmesí y negrita.
- Tablet y celular (< 1024 px): barra superior blanca con botón «Menú» de 44 px y el nombre de la
  etapa y la pantalla; el menú se abre como cajón (Escape lo cierra, el foco va al primer enlace).

## Accesibilidad

- Contraste AA en todo texto (≥ 4.5:1) y en bordes de controles (≥ 3:1).
- Foco visible: anillo carmesí de 3 px con separación de 2 px.
- `prefers-contrast: more`: textos secundarios y bordes suben a tinta.
- `prefers-reduced-motion`: sin transiciones ni animaciones, salvo el spinner, que gira lento (es la única señal de «cargando»).
- Salto al contenido, `aria-current` en las migas, regiones vivas en avisos y escáner.

## Pendiente / ideas

- `Paqueteria`, `Porcionado`, `Deshuese` y `Sacrificio` (formularios) todavía tienen hex y estilos en
  línea; conviene pasarlos a tokens cuando se toquen esas pantallas (`Maduracion`, `AnimalDetalle`,
  `Potreros`, `Bodegas` y el Resumen ya están en el sistema desde la pasada del 07-nov-2026).
- Los modales hechos a mano conviene migrarlos a `ui/Modal.jsx` cuando se toque cada pantalla;
  mientras tanto `useAccesibilidadGlobal` les da el comportamiento básico.
