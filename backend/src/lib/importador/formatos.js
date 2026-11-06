// Mapa de columnas por formato de archivo que la app sabe importar.
//
// Por qué un archivo de configuración: cada proveedor (Ganadero SG, CIISA, una foto leída por OCR)
// trae los mismos datos con otros nombres de columna, abreviados, truncados por el ancho de la
// celda o con títulos encima. El lector genérico (tabla.js) busca la fila de encabezado con estas
// listas; el procesador del formato (procesadores/*.js) decide qué hacer con cada fila.
//
// Para agregar un formato nuevo:
//   1. Una entrada aquí con sus columnas (`encabezados` = variantes, se comparan normalizadas:
//      sin tildes, minúsculas, sin puntuación; un encabezado truncado que sea el inicio de una
//      variante también cuenta, p. ej. «Fec. salid» → «fec salida»).
//   2. Un procesador con planificar(conn, lectura, opciones) y aplicar(conn, plan, contexto)
//      registrado en procesadores/index.js. El motor (motor.js) pone la vista previa, la huella,
//      la transacción y la bitácora; el procesador no repite nada de eso.
//   3. Si el formato llega por otra vía (foto → OCR), basta con que esa vía entregue filas
//      (arreglo de arreglos) a `lectura.hojas`: el resto del flujo es el mismo.
//
// Tipos de columna: texto | arete | ie | numero | entero | fecha | sexo.

const FORMATOS = {
  // Reporte personalizado de «Software GANADERO SG» (Sistematización de Hatos), finca
  // 01-003 ENGORDE WAGYU: los animales que salen de la finca a la planta. Es la base de la
  // guía de transporte (ver procesadores/ganaderoSg.js).
  'ganadero-sg': {
    nombre: 'Ganadero SG · salida de animales',
    descripcion: 'Reporte personalizado de Software GANADERO SG (Sistematización de Hatos)',
    procesador: 'ganaderoSg',
    extensiones: ['xlsx', 'xls', 'csv', 'txt', 'html', 'htm'],
    minimoColumnas: 6,
    // F. Nto y Fec. salida vienen m/d/aaaa (3/14/2024, 10/15/2026); si una columna trae un día
    // > 12 en la primera posición, el lector la cambia sola a d/m/aaaa (ver ordenFechaColumna).
    ordenFechas: 'mdy',
    columnas: [
      { clave: 'numero', encabezados: ['numero', 'numero del animal', 'n animal', 'arete'], tipo: 'arete', obligatoria: true },
      { clave: 'sexo', encabezados: ['sexo'], tipo: 'sexo' },
      { clave: 'edad_meses', encabezados: ['e mes', 'edad en meses', 'edad meses'], tipo: 'numero' },
      { clave: 'fecha_nacimiento', encabezados: ['f nto', 'fecha nacimiento', 'f nacimiento', 'fecha nto'], tipo: 'fecha' },
      { clave: 'raza', encabezados: ['raza'], tipo: 'texto' },
      { clave: 'madre', encabezados: ['n madre', 'nro madre', 'madre'], tipo: 'arete' },
      { clave: 'padre', encabezados: ['n padre', 'nro padre', 'padre'], tipo: 'arete' },
      { clave: 'potrero', encabezados: ['pot', 'potrero'], tipo: 'texto' },
      { clave: 'ie', encabezados: ['i e', 'ie', 'identificacion electronica'], tipo: 'ie' },
      { clave: 'dias_potrero', encabezados: ['dias pot', 'dias en potrero'], tipo: 'entero' },
      { clave: 'ultimo_peso', encabezados: ['u peso', 'ultimo peso', 'ult peso'], tipo: 'numero' },
      { clave: 'gr_dia_vida', encabezados: ['gr dia vida', 'gr dia', 'ganancia gr dia vida'], tipo: 'numero' },
      { clave: 'fecha_ultima_vacuna', encabezados: ['fuv', 'fecha ultima vacuna', 'f ult vacuna'], tipo: 'fecha' },
      { clave: 'ultima_vacuna', encabezados: ['uv', 'ultima vacuna', 'ult vacuna'], tipo: 'texto' },
      { clave: 'fecha_salida', encabezados: ['fec salida', 'fecha salida', 'f salida'], tipo: 'fecha' },
      { clave: 'causa_salida', encabezados: ['causa salida'], tipo: 'texto' },
      { clave: 'tipo_destino', encabezados: ['tipo dest', 'tipo destino'], tipo: 'texto' },
      { clave: 'obs_salida', encabezados: ['obs salida', 'observaciones salida'], tipo: 'texto' },
      { clave: 'peso_salida', encabezados: ['peso sal', 'peso salida', 'peso a la salida'], tipo: 'numero' },
      { clave: 'vendido_a', encabezados: ['vendido a', 'comprador'], tipo: 'texto' },
    ],
    // Datos que vienen ARRIBA del encabezado (títulos y leyenda del reporte).
    metadatos: [
      { clave: 'actualizado_a', patron: /actualizado\s+a\s*:?\s*(\S+)/i, tipo: 'fecha', orden: 'dmy' },
      { clave: 'impresion', patron: /impresi[oó]n\s*:?\s*(.+)$/i, tipo: 'texto' },
      { clave: 'finca', patron: /^\s*(\d{2}-\d{3}\s*-\s*.+?)\s*$/, tipo: 'texto' },
    ],
  },

  // Correo de la planta CIISA con el resultado del sacrificio (Gerardo Araya, «Sacrificio Wagyu
  // 15-10-26»): una tabla HTML pegada en el cuerpo. Llega pegada desde Outlook/Gmail/Excel o
  // como archivo .msg/.eml (ver archivos.js). La guía de transporte manda: ver procesadores/sacrificioCiisa.js.
  'sacrificio-ciisa': {
    nombre: 'Sacrificio CIISA (correo de la planta)',
    descripcion: 'Tabla del correo «Sacrificio Wagyu dd-mm-aa» de CIISA El Arreo',
    procesador: 'sacrificioCiisa',
    extensiones: ['msg', 'eml', 'html', 'htm', 'txt', 'csv', 'xlsx'],
    minimoColumnas: 5,
    ordenFechas: 'dmy',
    columnas: [
      { clave: 'cantidad', encabezados: ['cantidad', 'cant'], tipo: 'entero' }, // solo el consecutivo de fila: se ignora
      { clave: 'numero_canal', encabezados: ['numero de canal', 'n canal', 'canal', 'n de canal'], tipo: 'texto', obligatoria: true },
      { clave: 'sexo', encabezados: ['sexo'], tipo: 'sexo' },
      { clave: 'peso_pie', encabezados: ['peso pie kg', 'peso pie', 'peso en pie'], tipo: 'numero' },
      { clave: 'peso_canal', encabezados: ['peso canal kg', 'peso canal'], tipo: 'numero' },
      { clave: 'rendimiento', encabezados: ['rendimiento %', 'rendimiento', 'rend %', 'rend'], tipo: 'numero' },
      { clave: 'arete', encabezados: ['arete', 'numero animal'], tipo: 'arete', obligatoria: true },
      { clave: 'musculo', encabezados: ['musculo'], tipo: 'entero' },
      { clave: 'dientes', encabezados: ['dientes', 'denticion'], tipo: 'entero' },
      { clave: 'grasa', encabezados: ['grasa'], tipo: 'entero' },
      { clave: 'golpe', encabezados: ['golpe', 'golpes'], tipo: 'texto' },
      { clave: 'condicion_corporal', encabezados: ['condicion corporal', 'cond corporal', 'condicion'], tipo: 'texto' },
    ],
    // Pegado como texto plano sin encabezado reconocible (Gmail lo parte en varias líneas):
    // una fila de datos con exactamente estas columnas, en este orden, se acepta igual.
    posicional: ['cantidad', 'numero_canal', 'sexo', 'peso_pie', 'peso_canal', 'rendimiento', 'arete', 'musculo', 'dientes', 'grasa', 'golpe'],
    metadatos: [
      // Fecha del asunto «Sacrificio Wagyu 15-10-26» (también aparece en el cuerpo como «Asunto: …»).
      { clave: 'fecha_sacrificio', patron: /sacrificio[^0-9]{0,40}(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i, tipo: 'fecha', orden: 'dmy' },
    ],
  },

  // Medición de marmoleo de la cámara de canales (página web del proveedor: no exporta Excel,
  // se selecciona la tabla y se pega). Lo único que se registra es DMs (AUSMEAT) por animal; el
  // resto de columnas (DMp, NFI-2, DMa, DMs, DMs MSA, DMc y cualquier otra a la derecha) se
  // guarda como dato extra. «Body no.» = número de sacrificio (canal) + espacio + arete.
  'marmoleo-camara': {
    nombre: 'Marmoleo · cámara de canales',
    descripcion: 'Tabla de la cámara (Taken at, Body no., DMs AUSMEAT…) pegada desde la página o exportada',
    procesador: 'marmoleoCamara',
    extensiones: ['csv', 'txt', 'xlsx', 'html', 'htm'],
    minimoColumnas: 2,
    ordenFechas: 'dmy',
    guardarDesconocidas: true,
    columnas: [
      { clave: 'taken_at', encabezados: ['taken at', 'fecha', 'fecha hora'], tipo: 'fechahora' },
      { clave: 'body', encabezados: ['body no', 'body', 'body n'], tipo: 'texto', obligatoria: true },
      { clave: 'barcode', encabezados: ['barcode no', 'barcode', 'barcode n'], tipo: 'texto' },
      { clave: 'ausmeat', encabezados: ['dms ausmeat', 'dms aus meat', 'ausmeat', 'marmoleo ausmeat', 'marmoleo aus meat'], tipo: 'texto', obligatoria: true },
      { clave: 'dmp', encabezados: ['dmp %', 'dmp'], tipo: 'numero' },
      { clave: 'nfi2', encabezados: ['nfi 2', 'nfi2'], tipo: 'numero' },
      { clave: 'dma', encabezados: ['dma cm2', 'dma'], tipo: 'numero' },
      { clave: 'dms', encabezados: ['dms'], tipo: 'numero' },
      { clave: 'dms_msa', encabezados: ['dms msa'], tipo: 'numero' },
      { clave: 'dmc', encabezados: ['dmc'], tipo: 'numero' },
    ],
    metadatos: [],
  },

  // Reporte Diario de Producción de CIISA por animal: varios PDF a la vez (cada PDF = un lote = un
  // animal) y/o el texto pegado, más la lista lote → arete del correo en opciones.mapa. No es una
  // tabla con encabezado: modo «documentos» (el motor entrega el texto de cada archivo al procesador).
  'reporte-produccion-ciisa': {
    nombre: 'Reporte de producción CIISA (PDF por animal)',
    descripcion: 'Uno o varios PDF «REPORTE DIARIO DE PRODUCCION» más la lista lote → arete del correo',
    procesador: 'reporteProduccionCiisa',
    modo: 'documentos',
    extensiones: ['pdf', 'txt'],
    columnas: [],
    metadatos: [],
  },

  // Listado completo del catálogo de cortes (Excel de la planta o pegado): código, descripción y,
  // si vienen, tipo, unidad y activo. Compara contra la base: nuevos / cambian / sin cambios.
  'catalogo-cortes': {
    nombre: 'Catálogo de cortes (listado completo)',
    descripcion: 'Código de 5 dígitos y descripción; tipo, unidad y activo opcionales',
    procesador: 'catalogoCortes',
    extensiones: ['xlsx', 'csv', 'txt', 'html', 'htm'],
    minimoColumnas: 2,
    ordenFechas: 'dmy',
    columnas: [
      { clave: 'codigo', encabezados: ['codigo', 'cod', 'articulo', 'codigo articulo', 'sku'], tipo: 'texto', obligatoria: true },
      { clave: 'nombre', encabezados: ['descripcion', 'nombre', 'corte', 'nombre del corte', 'producto'], tipo: 'texto', obligatoria: true },
      { clave: 'tipo', encabezados: ['tipo', 'clase', 'categoria'], tipo: 'texto' },
      { clave: 'unidad', encabezados: ['unidad', 'um', 'unidad de medida'], tipo: 'texto' },
      { clave: 'activo', encabezados: ['activo', 'estado'], tipo: 'texto' },
    ],
    // Pegado sin encabezado: «22229  CH-CHUCK RES».
    posicional: ['codigo', 'nombre'],
    metadatos: [],
  },

  // Solicitud de deshuese histórica en el Excel de la planta («Solicitud_de_Deshuese_y_Porcionado.xlsx»,
  // hojas «Deshuese ddmmaa»). El procesador lee el libro crudo: ver docs/importadores/solicitud-deshuese.md.
  'solicitud-deshuese-excel': {
    nombre: 'Solicitud de deshuese (Excel de la planta)',
    descripcion: 'Hojas «Deshuese ddmmaa» del libro de solicitudes: canales por columna y cortes por fila',
    procesador: 'solicitudDeshueseExcel',
    modo: 'documentos',
    leerCrudo: true,
    maxMB: 40,
    extensiones: ['xlsx'],
    columnas: [],
    metadatos: [],
  },

  // PRÓXIMO (no implementado): inventario por tarimas que manda CIISA («INV WAGYU SEMANA 41.xlsx»;
  // la pestaña a importar es «INV GENERAL», además vienen MADURACION / TORTAS WAGYU). Su FECHA
  // VENCIMIENTO se resuelve con lib/vencimiento.js → resolverVencimiento (se respeta la del archivo y se
  // avisa si no es producción + 12 meses). En el código de caja, «xxx» = sin trazabilidad.
  // La hoja MADURACION es la ÚNICA visibilidad que el dueño tiene hoy de custodia/maduración; sus
  // columnas reales: TARIMA, CODIGO, DESCRIPCION, LOTE, CAJA, PESO, FECHA DE VENCIMIENTO FRESCO,
  // ESTATUS. El importador (siguiente PR) debe leer INV GENERAL y MADURACION. El lector ya detecta su encabezado; falta el
  // procesador que concilie contra etiquetas/primales/cajas. `procesador: null` lo deja fuera
  // de la pantalla y de la API hasta que exista.
  'inventario-ciisa': {
    nombre: 'Inventario por tarimas CIISA',
    descripcion: 'Pendiente: conciliación del inventario semanal de CIISA',
    procesador: null,
    extensiones: ['xlsx'],
    minimoColumnas: 4,
    ordenFechas: 'dmy',
    columnas: [
      { clave: 'tarima', encabezados: ['tarima'], tipo: 'texto' },
      { clave: 'codigo_barras', encabezados: ['codigo barras', 'cod barra'], tipo: 'texto' },
      { clave: 'codigo', encabezados: ['codigo'], tipo: 'texto' },
      { clave: 'descripcion', encabezados: ['descripcion'], tipo: 'texto' },
      { clave: 'peso', encabezados: ['peso'], tipo: 'numero' },
      { clave: 'lote', encabezados: ['lote'], tipo: 'texto' },
      { clave: 'caja', encabezados: ['caja'], tipo: 'texto' },
      { clave: 'fecha_vencimiento', encabezados: ['fecha vencimiento', 'fecha de vencimiento fresco'], tipo: 'fecha' },
    ],
    metadatos: [],
  },
  // PRÓXIMO (no implementado): lectura por foto (OCR). La vía de entrada sería otra (imagen →
  // servicio de OCR → filas), pero el formato resultante reutiliza uno de los de arriba.
};

function formato(id) {
  return Object.prototype.hasOwnProperty.call(FORMATOS, id) ? FORMATOS[id] : null;
}

/** Formatos que se pueden usar hoy (los que tienen procesador). */
function formatosHabilitados() {
  return Object.entries(FORMATOS)
    .filter(([, f]) => f.procesador)
    .map(([id, f]) => ({ id, nombre: f.nombre, descripcion: f.descripcion, extensiones: f.extensiones }));
}

module.exports = { FORMATOS, formato, formatosHabilitados };
