/**
 * Excel del Reporte Diario de Producción (mismo formato que el de CIISA) y plantilla de carga.
 *
 * Por qué exceljs: es la única librería madura que escribe estilos (formato #,##0.00, rellenos
 * de diferencias, anchos) y además LEE .xlsx para el importador, sin binarios nativos.
 * Se usa solo en el backend; la imagen Docker la instala con `npm install` al reconstruir.
 */

const ExcelJS = require('exceljs');
const { COLUMNAS_PLANTILLA, loteTexto } = require('./reporteProduccion');

const FMT_KG = '#,##0.00';
const ESTADOS = {
  cuadra: 'Cuadra',
  diferencia: 'Diferencia',
  solo_ciisa: 'No escaneado',
  solo_escaneo: 'No está en CIISA',
};
const RELLENO_DIF = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE9E7' } };
const RELLENO_TITULO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEAE6' } };
const BORDE = { style: 'thin', color: { argb: 'FFB9B5AC' } };

const fechaCorta = (iso) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a.slice(2)}`; // 21/09/26, como lo imprime CIISA
};

/** Lee una celda de exceljs como valor plano (texto enriquecido, fórmulas, hipervínculos). */
function valorCelda(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('result' in v) return valorCelda(v.result);
    if ('text' in v) return v.text;
    if ('error' in v) return null;
    return null;
  }
  return v;
}

/** Hoja de exceljs → arreglo de filas (base 0), con celdas ya aplanadas. */
function filasDeHoja(hoja) {
  const filas = [];
  hoja.eachRow({ includeEmpty: true }, (fila, n) => {
    const valores = Array.isArray(fila.values) ? fila.values.slice(1) : [];
    filas[n - 1] = valores.map(valorCelda);
  });
  for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
  return filas;
}

/**
 * Lee un .xlsx: hoja de reporte (la primera que tenga columnas Artículo y Peso) y hoja
 * «Aretes» si existe. Devuelve filas crudas; la interpretación es de reporteProduccion.js.
 */
async function leerLibro(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  const hojas = libro.worksheets.map(h => ({ nombre: h.name, filas: filasDeHoja(h) }));
  const esAretes = (h) => /arete/i.test(h.nombre);
  return {
    reporte: hojas.filter(h => !esAretes(h)).map(h => h.filas),
    aretes: hojas.filter(esAretes).map(h => h.filas)[0] || null,
  };
}

/** Plantilla descargable: columnas del reporte CIISA + hoja de aretes, con el ejemplo del 21/09/26 como guía. */
function construirPlantilla() {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Trazabilidad Hacienda Tempisque';
  const hoja = libro.addWorksheet('Reporte');
  hoja.addRow(COLUMNAS_PLANTILLA);
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).fill = RELLENO_TITULO;
  // Dos filas de ejemplo (del reporte real del 21/09/26) para que se vea el formato esperado.
  hoja.addRow(['21/09/26', '3', 'TEMPISQUE', '06', '11163', 'BEEF TRIMMINGS', 97.4, 'KGS', 4]);
  hoja.addRow(['21/09/26', '3', 'TEMPISQUE', '06', '21231', 'DELMONICO', 21.92, 'KGS', 2]);
  hoja.columns.forEach((c, i) => { c.width = [11, 10, 16, 9, 10, 36, 10, 8, 8][i]; });
  // Artículo, lote y fecha como texto: Excel le quita el cero a «06» y convierte fechas.
  ['A', 'B', 'D', 'E'].forEach(col => { hoja.getColumn(col).numFmt = '@'; });
  hoja.getColumn('G').numFmt = FMT_KG;

  const aretes = libro.addWorksheet('Aretes');
  aretes.addRow(['Fecha', 'Posición', 'Arete']);
  aretes.getRow(1).font = { bold: true };
  aretes.getRow(1).fill = RELLENO_TITULO;
  aretes.addRow(['21/09/26', '06', '72ELF']);
  aretes.addRow(['21/09/26', '07', '26FLB']);
  aretes.columns.forEach((c, i) => { c.width = [11, 10, 12][i]; });
  ['A', 'B', 'C'].forEach(col => { aretes.getColumn(col).numFmt = '@'; });

  const ayuda = libro.addWorksheet('Instrucciones');
  [
    'Cómo llenar la plantilla del Reporte Diario de Producción',
    '',
    '1. Hoja «Reporte»: una fila por artículo. Las columnas Fecha, Lote CC, Artículo, Peso y Cajas son obligatorias.',
    '2. Fecha en formato DD/MM/AA (21/09/26). Lote CC con dos dígitos (06). Artículo: código CIISA de 5 dígitos.',
    '3. Peso en kilos (KGS). Puede traer varios lotes CC o varias fechas en la misma hoja: la app los separa.',
    '4. Hoja «Aretes» (opcional): la tabla posición → arete que manda CIISA en el correo.',
    '5. Borre las filas de ejemplo antes de cargar. Las filas de totales se ignoran.',
  ].forEach(t => ayuda.addRow([t]));
  ayuda.getRow(1).font = { bold: true, size: 13 };
  ayuda.getColumn(1).width = 110;
  return libro;
}

/**
 * Una hoja por lote CC con el formato CIISA (columnas A–E) y la conciliación al lado (G–K).
 * Tabla posición → arete del día en M–N.
 * @param {{ fecha: string, lotes: object[], aretes: object[] }} reporte  salida de GET /api/reporte-produccion
 */
function construirLibroReporte(reporte) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Trazabilidad Hacienda Tempisque';
  const lotes = reporte.lotes.length ? reporte.lotes : [null];

  for (const lote of lotes) {
    const nombre = lote ? `Lote CC ${loteTexto(lote.lote_cc)}` : 'Sin datos';
    const h = libro.addWorksheet(nombre, { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    h.columns = [
      { width: 10 }, { width: 38 }, { width: 11 }, { width: 8 }, { width: 8 }, { width: 3 },
      { width: 12 }, { width: 11 }, { width: 10 }, { width: 10 }, { width: 18 }, { width: 3 },
      { width: 10 }, { width: 12 },
    ];
    h.getCell('A1').value = 'REPORTE DIARIO DE PRODUCCION';
    h.getCell('A1').font = { bold: true, size: 14 };
    h.getCell('A3').value = 'Fecha de Produccion:';
    h.getCell('C3').value = fechaCorta(reporte.fecha);
    const enc = lote?.encabezado || {};
    h.getCell('A4').value = 'Num. Lote';
    h.getCell('B4').value = enc.num_lote || '';
    h.getCell('C4').value = 'Tipo Produccion:';
    h.getCell('E4').value = enc.tipo_produccion || '';
    h.getCell('A5').value = 'Lote CC';
    h.getCell('B5').value = lote ? loteTexto(lote.lote_cc) : '';
    if (lote?.arete) { h.getCell('C5').value = 'Arete:'; h.getCell('E5').value = lote.arete; }
    ['A3', 'A4', 'C4', 'A5', 'C5'].forEach(c => { h.getCell(c).font = { bold: true }; });

    const titulos = ['Articulo', 'Descripcion', 'Peso', 'Unidad', 'Cajas', '', 'Kg escaneados', 'Cajas escan.', 'Dif. kg', 'Dif. cajas', 'Conciliación'];
    const filaTit = h.getRow(7);
    titulos.forEach((t, i) => { if (t) filaTit.getCell(i + 1).value = t; });
    filaTit.font = { bold: true };
    [1, 2, 3, 4, 5, 7, 8, 9, 10, 11].forEach(i => {
      filaTit.getCell(i).fill = RELLENO_TITULO;
      filaTit.getCell(i).border = { bottom: BORDE };
    });
    h.getCell('G6').value = 'Conciliación contra lo escaneado en la app';
    h.getCell('G6').font = { italic: true };

    let r = 8;
    for (const f of lote?.filas || []) {
      const fila = h.getRow(r);
      fila.getCell(1).value = f.articulo; // texto: conserva el código tal cual
      fila.getCell(2).value = f.descripcion || '';
      fila.getCell(3).value = f.kg_ciisa;
      fila.getCell(4).value = f.kg_ciisa === null ? '' : (f.unidad || 'KGS');
      fila.getCell(5).value = f.cajas_ciisa;
      fila.getCell(7).value = f.kg_escaneado;
      fila.getCell(8).value = f.cajas_escaneado;
      fila.getCell(9).value = f.dif_kg;
      fila.getCell(10).value = f.dif_cajas;
      fila.getCell(11).value = ESTADOS[f.estado] || f.estado;
      [3, 7, 9].forEach(c => { fila.getCell(c).numFmt = FMT_KG; });
      if (f.estado !== 'cuadra' && lote.resumen.ciisa && lote.resumen.escaneado) {
        [9, 10, 11].forEach(c => { fila.getCell(c).fill = RELLENO_DIF; });
        fila.getCell(11).font = { bold: true, color: { argb: 'FF8F1D17' } };
      }
      r++;
    }
    if (!lote || !(lote.filas || []).length) {
      h.getCell(`A${r}`).value = 'No hay deshuese registrado para esa fecha y lote.';
      r++;
    }

    // Pie igual al de CIISA: «Total de Cajas por el Lote # n | Libras | Kilos | cajas».
    r++;
    const ciisa = lote?.resumen?.ciisa;
    const esc = lote?.resumen?.escaneado;
    const pie = h.getRow(r);
    pie.getCell(1).value = `Total de Cajas por el Lote # ${enc.num_lote || (lote ? loteTexto(lote.lote_cc) : '')}`;
    pie.getCell(2).value = ciisa ? `Libras ${ciisa.libras.toFixed(2)}   Kilos` : 'Sin reporte de CIISA';
    pie.getCell(2).alignment = { horizontal: 'right' };
    pie.getCell(3).value = ciisa ? ciisa.kilos : null;
    pie.getCell(4).value = ciisa ? 'KGS' : null;
    pie.getCell(5).value = ciisa ? ciisa.cajas : null;
    pie.getCell(7).value = esc ? esc.kilos : null;
    pie.getCell(8).value = esc ? esc.cajas : null;
    if (lote?.resumen?.diferencia) {
      pie.getCell(9).value = lote.resumen.diferencia.kilos;
      pie.getCell(10).value = lote.resumen.diferencia.cajas;
    }
    [3, 7, 9].forEach(c => { pie.getCell(c).numFmt = FMT_KG; });
    pie.font = { bold: true };
    [1, 2, 3, 4, 5, 7, 8, 9, 10].forEach(c => { pie.getCell(c).border = { top: BORDE }; });
    // Libras también como número (la celda de arriba es texto, igual que en el impreso de CIISA).
    const lib = h.getRow(r + 1);
    lib.getCell(2).value = 'Libras';
    lib.getCell(2).alignment = { horizontal: 'right' };
    lib.getCell(3).value = ciisa ? ciisa.libras : null;
    lib.getCell(7).value = esc ? esc.libras : null;
    [3, 7].forEach(c => { lib.getCell(c).numFmt = FMT_KG; });

    // Tabla posición → arete del día (columnas M–N), como la del correo de CIISA.
    h.getCell('M7').value = 'Posición';
    h.getCell('N7').value = 'ARETE';
    ['M7', 'N7'].forEach(c => { h.getCell(c).font = { bold: true }; h.getCell(c).fill = RELLENO_TITULO; });
    (reporte.aretes || []).forEach((a, i) => {
      h.getCell(`M${8 + i}`).value = loteTexto(a.posicion);
      h.getCell(`N${8 + i}`).value = a.arete;
      if (lote && a.posicion === lote.lote_cc) {
        h.getCell(`M${8 + i}`).font = { bold: true };
        h.getCell(`N${8 + i}`).font = { bold: true };
      }
    });
    h.views = [{ state: 'frozen', ySplit: 7 }];
  }
  return libro;
}

module.exports = { construirPlantilla, construirLibroReporte, leerLibro, filasDeHoja, valorCelda, fechaCorta };
