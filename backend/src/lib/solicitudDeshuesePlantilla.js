/**
 * «Descargar Excel para la planta»: llena la PLANTILLA REAL de la planta (backend/plantillas/
 * solicitud-deshuese.xlsx, sacada de la hoja «Deshuese 160524» del libro que usa el dueño) en vez
 * de un Excel armado de cero. Se conserva todo lo que la planta ya conoce: formato, celdas
 * combinadas y fórmulas (peso deshuese = canal × 84 %, merma de transporte, rendimientos, BCH…).
 *
 * Mapeo (detalle en docs/importadores/solicitud-deshuese.md):
 *   - 5 canales por hoja en las columnas G, I, K, M, O (H, J, L, N, P son de cálculo); con más de
 *     5 canales se agregan hojas copiando la primera («Deshuese ddmmaa (2)»…).
 *   - Filas 3–12: Arete, Sexo (M/H), Padre, Peso en pie (finca), Peso pie planta, Peso canal,
 *     Consecutivo (n.º de canal), Lote de deshuese (vacío: lo llena la planta), Marble score.
 *   - Filas 18–71: un corte por fila, código en la columna B. Se escribe el n.º de medias (0, 1 o 2)
 *     de la solicitud en la celda de cada canal; si la plantilla traía ahí una fórmula (=2-G18) y
 *     la solicitud tiene ese corte, manda la solicitud. Observación del corte → columna Q.
 *   - Cortes de la solicitud que la plantilla no tiene → hoja «Cortes adicionales».
 * Si una celda de canal queda vacía, Excel calcula igual (las fórmulas tratan vacío como 0).
 */

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const PLANTILLA = path.join(__dirname, '..', '..', 'plantillas', 'solicitud-deshuese.xlsx');
const COLS = ['G', 'I', 'K', 'M', 'O'];
const POR_HOJA = COLS.length;
const FILA = { arete: 3, sexo: 4, padre: 5, peso_pie: 6, peso_planta: 7, peso_canal: 8, consecutivo: 9, lote: 10, marmoleo: 12 };
const PRIMERA_FILA_CORTE = 18;
const ULTIMA_FILA_CORTE = 71;

const fechaCorta = (iso) => { const [a, m, d] = String(iso).split('-'); return `${d}${m}${a.slice(2)}`; };
const numeroOTexto = (v) => (v != null && /^\d+$/.test(String(v)) ? Number(v) : (v ?? null));

/** Copia una hoja dentro del mismo libro (exceljs no tiene «duplicar hoja»: se clona su modelo). */
function clonarHoja(libro, base, nombre) {
  const nueva = libro.addWorksheet(nombre);
  const modelo = JSON.parse(JSON.stringify(base.model));
  modelo.name = nombre;
  modelo.id = nueva.id;
  nueva.model = { ...modelo, mergeCells: base.model.merges };
  return nueva;
}

/** Filas de la plantilla por código de corte (la plantilla repite 22101: Lomito y Lomito cabeza). */
function filasPorCodigo(hoja) {
  const mapa = new Map();
  for (let f = PRIMERA_FILA_CORTE; f <= ULTIMA_FILA_CORTE; f++) {
    const v = hoja.getCell(`B${f}`).value;
    const codigo = v == null ? null : String(typeof v === 'object' && v.result != null ? v.result : v).replace(/\.0+$/, '').trim();
    if (!codigo || !/^\d{5}$/.test(codigo)) continue;
    if (!mapa.has(codigo)) mapa.set(codigo, []);
    mapa.get(codigo).push(f);
  }
  return mapa;
}

/**
 * @param {object} modelo  el de GET /api/solicitudes-deshuese/:id (canales + cortes + medias)
 * @returns {Promise<ExcelJS.Workbook>}
 */
async function llenarPlantilla(modelo) {
  if (!fs.existsSync(PLANTILLA)) throw new Error(`Falta la plantilla ${PLANTILLA}`);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(PLANTILLA);
  const base = libro.worksheets[0];
  const nombreBase = `Deshuese ${fechaCorta(modelo.fecha_sacrificio)}`;
  base.name = nombreBase;
  const filasCorte = filasPorCodigo(base);

  const canales = modelo.canales;
  const hojas = [base];
  const nHojas = Math.max(1, Math.ceil(canales.length / POR_HOJA));
  for (let i = 1; i < nHojas; i++) hojas.push(clonarHoja(libro, base, `${nombreBase} (${i + 1})`));

  const adicionales = modelo.cortes.filter((c) => !filasCorte.has(String(c.codigo)));

  hojas.forEach((hoja, h) => {
    const grupo = canales.slice(h * POR_HOJA, (h + 1) * POR_HOJA);
    hoja.getCell('Q2').value = `Fecha de sacrificio: ${String(modelo.fecha_sacrificio).split('-').reverse().join('/')}`;
    COLS.forEach((col, i) => {
      const c = grupo[i];
      hoja.getCell(`${col}2`).value = `Canal # ${h * POR_HOJA + i + 1}`;
      if (!c) return;
      hoja.getCell(`${col}${FILA.arete}`).value = c.arete || null;
      hoja.getCell(`${col}${FILA.sexo}`).value = c.sexo === 'macho' ? 'M' : c.sexo === 'hembra' ? 'H' : null;
      hoja.getCell(`${col}${FILA.padre}`).value = c.padre_numero || null;
      hoja.getCell(`${col}${FILA.peso_pie}`).value = c.peso_pie_finca ?? null;
      hoja.getCell(`${col}${FILA.peso_planta}`).value = c.peso_vivo ?? null;
      hoja.getCell(`${col}${FILA.peso_canal}`).value = c.peso_canal ?? null;
      hoja.getCell(`${col}${FILA.consecutivo}`).value = numeroOTexto(c.numero_canal);
      hoja.getCell(`${col}${FILA.marmoleo}`).value = c.marmoleo ?? null;
      for (const corte of modelo.cortes) {
        const filas = filasCorte.get(String(corte.codigo));
        if (!filas) continue;
        const medias = corte.medias ? corte.medias[c.sacrificio_id] : undefined;
        if (medias === undefined || medias === null) continue;
        for (const f of filas) hoja.getCell(`${col}${f}`).value = Number(medias);
      }
    });
    for (const corte of modelo.cortes) {
      const filas = filasCorte.get(String(corte.codigo));
      if (filas && corte.observacion) for (const f of filas) hoja.getCell(`Q${f}`).value = corte.observacion;
    }
  });

  if (adicionales.length) {
    const extra = libro.addWorksheet('Cortes adicionales');
    extra.columns = [{ header: 'Código', width: 10 }, { header: 'Corte', width: 40 },
      ...canales.map((c, i) => ({ header: `Canal # ${i + 1} (${c.arete || ''})`, width: 16 })), { header: 'Observaciones', width: 40 }];
    extra.getRow(1).font = { bold: true };
    for (const corte of adicionales) {
      extra.addRow([corte.codigo, corte.nombre || '', ...canales.map((c) => (corte.medias ? corte.medias[c.sacrificio_id] ?? null : null)), corte.observacion || '']);
    }
  }
  // Las fórmulas se guardan sin resultado: que Excel/LibreOffice recalculen al abrir.
  libro.calcProperties = { ...(libro.calcProperties || {}), fullCalcOnLoad: true };
  return libro;
}

module.exports = { llenarPlantilla, PLANTILLA, filasPorCodigo, POR_HOJA };
