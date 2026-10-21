/**
 * Excel de la Solicitud de deshuese, con el mismo acomodo de la hoja que hoy se manda a la planta:
 *   - encabezado por canal arriba (una columna por canal: arete, sexo, pesos, n.º de canal,
 *     lote de deshuese en blanco para que lo llene la planta, peso de deshuese estimado), y
 *   - cortes en filas abajo (código CIISA, NAMP, nombre, medias por canal, observaciones).
 * Las columnas de canal son las mismas en los dos bloques, así la planta lee de arriba abajo.
 *
 * Se usa exceljs, la misma librería del Reporte Diario de Producción (lib/reporteProduccionExcel.js).
 */

const ExcelJS = require('exceljs');

const FMT_KG = '#,##0.00'; // 1,984.25: formato numérico que usa el cliente
const RELLENO_TITULO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEAE6' } };
const RELLENO_CERO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F4F0' } };
const BORDE = { style: 'thin', color: { argb: 'FFB9B5AC' } };
const BORDES = { top: BORDE, left: BORDE, bottom: BORDE, right: BORDE };
const COLS_FIJAS = 3; // A Código · B NAMP · C Corte (en el encabezado, A–C es la etiqueta)

const ESTADO_TEXTO = { borrador: 'Borrador', enviada: 'Enviada', deshuesada: 'Deshuesada' };
const SEXO_TEXTO = { macho: 'Macho', hembra: 'Hembra' };

const fechaCR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const numero = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * @param {object} modelo  lo mismo que devuelve GET /api/solicitudes-deshuese/:id
 * @returns {ExcelJS.Workbook}
 */
function construirLibroSolicitud(modelo) {
  const { solicitud, fecha_sacrificio: fecha, canales, cortes, planta, pct_deshuese_est: pct } = modelo;
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Trazabilidad Hacienda Tempisque';
  const hoja = libro.addWorksheet('Solicitud', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    views: [{ state: 'frozen', xSplit: COLS_FIJAS }],
  });

  const nCanales = canales.length;
  const colObs = COLS_FIJAS + nCanales + 1;
  const ultimaCol = colObs;

  // ── Título ──
  hoja.mergeCells(1, 1, 1, ultimaCol);
  const titulo = hoja.getCell(1, 1);
  titulo.value = `SOLICITUD DE DESHUESE${solicitud && solicitud.numero ? ` N.º ${solicitud.numero}` : ''}`;
  titulo.font = { bold: true, size: 14 };

  const datos = [
    ['Fecha de sacrificio', fechaCR(fecha)],
    ['Planta', planta && planta.nombre ? planta.nombre : ''],
    ['Marca', planta && planta.marca_comercial ? planta.marca_comercial : ''],
    ['Estado', solicitud ? ESTADO_TEXTO[solicitud.estado] || solicitud.estado : 'Sin guardar'],
  ];
  if (solicitud && solicitud.enviada_en) datos.push(['Enviada', `${solicitud.enviada_en}${solicitud.enviada_a ? ` a ${solicitud.enviada_a}` : ''}`]);
  if (solicitud && solicitud.observaciones) datos.push(['Observaciones', solicitud.observaciones]);
  let fila = 2;
  for (const [etiqueta, valor] of datos) {
    hoja.getCell(fila, 1).value = etiqueta;
    hoja.getCell(fila, 1).font = { bold: true };
    hoja.mergeCells(fila, 2, fila, Math.max(COLS_FIJAS, ultimaCol));
    hoja.getCell(fila, 2).value = valor;
    fila += 1;
  }
  fila += 1;

  // ── Bloque por canal (una columna por canal) ──
  const pctTexto = `${Math.round((pct || 0) * 100)} %`;
  const filasCanal = [
    ['Canal', (c, i) => i + 1, null],
    ['Arete', (c) => c.arete || '', null],
    ['Sexo', (c) => SEXO_TEXTO[c.sexo] || c.sexo || '', null],
    ['Peso en pie finca (kg)', (c) => numero(c.peso_pie_finca), FMT_KG],
    ['Peso en pie planta (kg)', (c) => numero(c.peso_vivo), FMT_KG],
    ['Peso canal (kg)', (c) => numero(c.peso_canal), FMT_KG],
    ['N.º de canal', (c) => c.numero_canal || '', '@'],
    ['Lote de deshuese', () => '', '@'], // lo llena la planta al deshuesar
    [`Peso deshuese estimado (kg, ${pctTexto} del canal)`, (c) => numero(c.peso_deshuese_est), FMT_KG],
  ];
  for (const [etiqueta, valorDe, fmt] of filasCanal) {
    hoja.mergeCells(fila, 1, fila, COLS_FIJAS);
    const celdaEtiqueta = hoja.getCell(fila, 1);
    celdaEtiqueta.value = etiqueta;
    celdaEtiqueta.font = { bold: true };
    celdaEtiqueta.fill = RELLENO_TITULO;
    celdaEtiqueta.border = BORDES;
    canales.forEach((c, i) => {
      const celda = hoja.getCell(fila, COLS_FIJAS + 1 + i);
      celda.value = valorDe(c, i);
      if (fmt) celda.numFmt = fmt;
      celda.alignment = { horizontal: 'center' };
      celda.border = BORDES;
      if (etiqueta === 'Arete' || etiqueta === 'Canal') celda.font = { bold: true };
    });
    fila += 1;
  }
  fila += 1;

  // ── Cortes en filas ──
  const encabezado = ['Código CIISA', 'NAMP', 'Corte', ...canales.map((c, i) => c.arete || `Canal ${i + 1}`), 'Observaciones'];
  encabezado.forEach((t, i) => {
    const celda = hoja.getCell(fila, i + 1);
    celda.value = t;
    celda.font = { bold: true };
    celda.fill = RELLENO_TITULO;
    celda.border = BORDES;
    celda.alignment = { horizontal: i >= COLS_FIJAS && i < colObs - 1 ? 'center' : 'left', vertical: 'middle', wrapText: true };
  });
  fila += 1;

  const totales = canales.map(() => 0);
  for (const corte of cortes) {
    hoja.getCell(fila, 1).value = corte.codigo;
    hoja.getCell(fila, 1).numFmt = '@';
    hoja.getCell(fila, 2).value = corte.namp || '';
    hoja.getCell(fila, 3).value = corte.nombre || '';
    canales.forEach((c, i) => {
      const m = Number(corte.medias[c.sacrificio_id] ?? 0);
      totales[i] += m;
      const celda = hoja.getCell(fila, COLS_FIJAS + 1 + i);
      celda.value = m;
      celda.alignment = { horizontal: 'center' };
      if (m === 0) celda.fill = RELLENO_CERO; // los ceros (no deshuesar) se distinguen al imprimir
    });
    hoja.getCell(fila, colObs).value = corte.observacion || '';
    for (let col = 1; col <= ultimaCol; col++) hoja.getCell(fila, col).border = BORDES;
    fila += 1;
  }

  hoja.mergeCells(fila, 1, fila, COLS_FIJAS);
  hoja.getCell(fila, 1).value = 'Total de medias';
  hoja.getCell(fila, 1).font = { bold: true };
  totales.forEach((t, i) => {
    const celda = hoja.getCell(fila, COLS_FIJAS + 1 + i);
    celda.value = t;
    celda.font = { bold: true };
    celda.alignment = { horizontal: 'center' };
  });
  for (let col = 1; col <= ultimaCol; col++) {
    hoja.getCell(fila, col).border = { ...BORDES, top: { style: 'medium', color: { argb: 'FF6B665C' } } };
  }
  fila += 2;
  hoja.getCell(fila, 1).value = 'Medias por canal: 0 = no deshuesar ese corte · 1 = una media canal · 2 = las dos medias.';
  hoja.getCell(fila, 1).font = { italic: true, color: { argb: 'FF6B665C' } };

  hoja.getColumn(1).width = 14;
  hoja.getColumn(2).width = 10;
  hoja.getColumn(3).width = 34;
  for (let i = 0; i < nCanales; i++) hoja.getColumn(COLS_FIJAS + 1 + i).width = 12;
  hoja.getColumn(colObs).width = 36;
  return libro;
}

module.exports = { construirLibroSolicitud };
