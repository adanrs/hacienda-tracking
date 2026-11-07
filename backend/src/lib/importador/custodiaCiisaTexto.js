// Lector del texto de los documentos de custodia de CIISA («Sistema de Control de Inventario»,
// reporte inv_rpt_docu):
//   ASE · «AJUSTE DE SALIDA EN CUSTODIA»: producto que sale de la custodia (bodega 107 EQTB
//         TEMPISQUE), p. ej. «AUTORIZA JUAN CARLOS GILLEN, PRODUCTO PARA ZAMU».
//   TRE · «TRASLADO DE INVENTARIO EN CUSTODIA»: de la 107 a otra bodega de la planta (p. ej.
//         08 PAQUETERIA-MATERIA PRIMA), con «CORTES FINOS LOTE 35 / RES 5094» en Observaciones.
//
// Encabezado: No., Bodega Origen/Destino («107 EQTB TEMPISQUE»), Fecha «24-04-2026 16:04:48»,
// Estado, Observaciones. Líneas: Artículo (5 dígitos), Descripción, Und.Alm. (CAJ), Unidades,
// Und.Pes. (KGS), Peso y a veces «Peso kg» repetido. Pie: totales de unidades y peso.
//
// Igual que la guía del MAG, el texto puede venir de pdf-parse (columnas pegadas), de Word (por
// tabulador) o de la lectura por foto (vision.js, con etiquetas «Fecha: …»). Puro: no toca la base.

const pad = (n) => String(n).padStart(2, '0');

/** «1,234.50» / «1.00» / «381,08» → número (o null). */
function numero(v) {
  if (v == null) return null;
  let t = String(v).trim();
  if (!t) return null;
  if (/,\d{1,2}$/.test(t) && !/\./.test(t)) t = t.replace(',', '.');
  t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** «26-03-2024 14:03:07» → { fecha: '2024-03-26', hora: '14:03:07' }. */
function fechaHora(texto) {
  const m = String(texto || '').match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ \t]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return { fecha: null, hora: null };
  const dia = Number(m[1]); const mes = Number(m[2]);
  let anio = Number(m[3]);
  if (anio < 100) anio += 2000;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (mes < 1 || mes > 12 || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return { fecha: null, hora: null };
  const hora = m[4] != null && Number(m[4]) < 24 ? `${pad(m[4])}:${m[5]}:${m[6] || '00'}` : null;
  return { fecha: `${anio}-${pad(mes)}-${pad(dia)}`, hora };
}

/** «107 EQTB TEMPISQUE» → { codigo: '107', nombre: 'EQTB TEMPISQUE' }. */
function bodega(lineas, re) {
  for (const l of lineas) {
    const m = l.match(re);
    if (!m) continue;
    const resto = l.slice(m.index + m[0].length).replace(/^[ \t:]+/, '');
    const b = resto.match(/^(\d{1,4})[ \t]*[-–]?[ \t]*(.*)$/);
    if (!b) return null;
    // El nombre se corta donde empieza otra columna del encabezado (Estado, Lote, No.).
    const nombre = b[2].split(/\t|\s{2,}|\b(?:Estado|Lote|No\.)\s*:/i)[0].trim();
    return { codigo: b[1], nombre: nombre.slice(0, 100) || null };
  }
  return null;
}

const UNIDADES_ALM = 'CAJ|CAJA|CAJAS|UND|UNID|UNI|BOL|PZA';
const UNIDADES_PESO = 'KGS|KG|KILOS|LBS|LB';
// Una línea de artículo en texto corrido: «25000 BCH WAGYU CAJ 14 KGS 381.08 381.08» o pegada por
// pdf-parse («25000BCH WAGYUCAJ14KGS381.08381.08»). El peso trae siempre 2 decimales: así se separan
// dos pesos pegados («381.08381.08»).
const RE_LINEA = new RegExp(`^(\\d{5})\\s*(.+?)\\s*(${UNIDADES_ALM})\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIDADES_PESO})\\s*(\\d[\\d,]*\\.\\d{2})(?:\\s*(\\d[\\d,]*\\.\\d{2}))?\\s*$`, 'i');
const ES_UNIDAD = new RegExp(`^(${UNIDADES_ALM}|${UNIDADES_PESO})$`, 'i');

/** Línea de artículo → { codigo, descripcion, unidad, cajas, unidad_peso, kg } o null. */
function lineaArticulo(l) {
  const t = l.trim();
  if (!/^\d{5}(?!\d)/.test(t)) return null;
  // Por tabulador (Word, lectura por foto): código, descripción y las columnas numéricas.
  if (t.includes('\t')) {
    const celdas = t.split('\t').map((c) => c.trim()).filter(Boolean);
    const codigo = celdas[0].slice(0, 5);
    const resto = [celdas[0].slice(5).trim(), ...celdas.slice(1)].filter(Boolean);
    const nums = resto.filter((c) => numero(c) != null && /^[\d.,]+$/.test(c)).map(numero);
    const unidades = resto.filter((c) => ES_UNIDAD.test(c)).map((c) => c.toUpperCase());
    const descripcion = resto.find((c) => !/^[\d.,]+$/.test(c) && !ES_UNIDAD.test(c)) || null;
    const peso = unidades.find((u) => /^(LBS?|KGS?|KILOS)$/.test(u)) || null;
    return {
      codigo, descripcion, unidad: unidades.find((u) => !/^(LBS?|KGS?|KILOS)$/.test(u)) || null,
      cajas: nums.length >= 2 ? nums[0] : null,
      // Si trae «Peso» en libras y «Peso kg», el último es el de kilos.
      kg: nums.length ? nums[nums.length - 1] : null, unidad_peso: peso,
    };
  }
  const m = t.match(RE_LINEA);
  if (m) {
    return {
      codigo: m[1], descripcion: m[2].trim(), unidad: m[3].toUpperCase(), cajas: numero(m[4]),
      unidad_peso: m[5].toUpperCase(), kg: numero(m[7] != null ? m[7] : m[6]),
    };
  }
  // Sin unidades (texto pegado a mano): «22140 CESINA DE RES LIMPIA CP 1.00 3.66».
  const s = t.match(/^(\d{5})\s+(.+?)\s+(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*\.\d{1,3})\s*$/);
  if (s) return { codigo: s[1], descripcion: s[2].trim(), unidad: null, cajas: numero(s[3]), unidad_peso: null, kg: numero(s[4]) };
  return { codigo: t.slice(0, 5), descripcion: t.slice(5).trim() || null, unidad: null, cajas: null, unidad_peso: null, kg: null, ilegible: true };
}

const TIPOS = {
  ajuste_salida: { corto: 'ASE', nombre: 'Ajuste de salida en custodia' },
  traslado: { corto: 'TRE', nombre: 'Traslado de inventario en custodia' },
};

/**
 * Lote CC y RES (n.º de canal) de las Observaciones: «CORTES FINOS LOTE 35 / RES 5094».
 * Se leen TODOS los LOTE y RES: un mismo documento puede cubrir varios animales («LOTE 35 / RES 5094
 * Y LOTE 36 / RES 5095»). Si hay más de un lote o más de una RES distintos no hay un solo animal que
 * ligar: se devuelven en null con varios_animales = true y el documento se liga a mano. Quedarse con
 * el primero ligaría todo el documento a un animal que solo tiene parte de los cortes.
 */
function loteYRes(observaciones) {
  const t = String(observaciones || '');
  const lotes = [...new Set([...t.matchAll(/\bLOTE\s*(?:CC)?\s*[#:.]?\s*(\d{1,4})\b/gi)].map((m) => Number(m[1])))];
  const reses = [...t.matchAll(/\bRES\s*[#:.]?\s*(\d{3,6})\b/gi)].map((m) => m[1]);
  // «RES 05094» y «RES 5094» son la misma canal: se cuentan sin ceros a la izquierda.
  const resesDistintas = new Set(reses.map((r) => r.replace(/^0+(?=\d)/, '')));
  if (lotes.length > 1 || resesDistintas.size > 1) return { lote_cc: null, res: null, varios_animales: true };
  return { lote_cc: lotes.length ? lotes[0] : null, res: reses.length ? reses[0] : null, varios_animales: false };
}

const ENCABEZADOS_COLUMNA = /\b(Articulo|Art[ií]culo|Descripci[oó]n|Und\.?\s*Alm\.?|Uda\s*Alm|Unidades|Und\.?\s*Pes\.?|Uda\s*Pes|Peso(\s*kg)?)\b/gi;

/**
 * Texto de un documento de custodia → { tipo, numero, fecha, hora, bodega_origen, bodega_destino,
 * estado, observaciones, lote_cc, res, lineas: [...], total_cajas, total_kg, avisos }.
 */
function parsearDocumentoCustodia(texto) {
  const lineas = String(texto || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/[  ]+/g, ' ').trim()).filter(Boolean);
  const todo = lineas.join('\n');
  const avisos = [];
  let tipo = null;
  if (/ajuste\s+de\s+salida\s+en\s+custodia/i.test(todo) || /^tipo\s*:\s*ASE\b/im.test(todo)) tipo = 'ajuste_salida';
  else if (/traslado\s+de\s+inventario\s+en\s+custodia/i.test(todo) || /^tipo\s*:\s*TRE\b/im.test(todo)) tipo = 'traslado';

  const mNum = todo.match(/\bNo\.?[ \t]*:?[ \t]*(\d{1,8})\b/i);
  const numeroDoc = mNum ? Number(mNum[1]) : null;
  const lineaFecha = lineas.find((l) => /^fecha\b/i.test(l)) || '';
  const { fecha, hora } = fechaHora(lineaFecha);
  const mEstado = todo.match(/\bEstado[ \t]*:?[ \t]*([A-Za-zÁÉÍÓÚáéíóú]+)/);

  // Observaciones: en la misma línea («Observaciones AUTORIZA …») o en la siguiente, donde el
  // reporte la imprime al lado del título «Articulo» (TRE).
  let observaciones = null;
  const iObs = lineas.findIndex((l) => /^observaciones\b/i.test(l));
  if (iObs >= 0) {
    observaciones = lineas[iObs].replace(/^observaciones[ \t]*:?/i, '').trim();
    if (!observaciones && lineas[iObs + 1] && !/^\d{5}(?!\d)/.test(lineas[iObs + 1])) {
      observaciones = lineas[iObs + 1].replace(ENCABEZADOS_COLUMNA, ' ').replace(/\s+/g, ' ').trim();
    }
    observaciones = observaciones ? observaciones.replace(/^[:\-–]\s*/, '').slice(0, 500) : null;
  }

  const lineasDoc = [];
  let ultima = -1;
  lineas.forEach((l, i) => {
    if (/^tipo\s*:/i.test(l)) return;
    const a = lineaArticulo(l);
    if (!a) return;
    lineasDoc.push({ orden: lineasDoc.length + 1, ...a });
    ultima = i;
  });

  // Totales: la línea «TOTALES …» o, al pie, la que termina con «unidades peso» («… 20.00 147.80»).
  let totalCajas = null; let totalKg = null;
  const pie = ultima >= 0 ? lineas.slice(ultima + 1) : lineas;
  const lTotal = pie.find((l) => /\btotal(es)?\b/i.test(l) && /\d/.test(l.replace(/\btotal(es)?\b/i, '')))
    || pie.find((l) => /(\d[\d,]*(?:\.\d+)?)\s+(\d[\d,]*\.\d{2})\s*$/.test(l));
  if (lTotal) {
    const nums = (lTotal.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(numero).filter((n) => n != null);
    if (nums.length >= 2) { totalCajas = nums[nums.length - 2]; totalKg = nums[nums.length - 1]; } else if (nums.length === 1) totalKg = nums[0];
  }
  const sumaCajas = lineasDoc.reduce((s, l) => s + (l.cajas || 0), 0);
  const sumaKg = Math.round(lineasDoc.reduce((s, l) => s + (l.kg || 0), 0) * 1000) / 1000;
  if (totalKg != null && lineasDoc.length && Math.abs(totalKg - sumaKg) > 0.05) {
    avisos.push(`El total del documento es ${totalKg} kg y las líneas leídas suman ${sumaKg} kg: revise si falta una página o una línea`);
  }
  if (totalCajas != null && lineasDoc.length && Math.abs(totalCajas - sumaCajas) > 0.001) {
    avisos.push(`El documento dice ${totalCajas} unidades y las líneas leídas suman ${sumaCajas}`);
  }

  const lr = loteYRes(observaciones);
  if (lr.varios_animales) avisos.push('Sin animal: el documento cubre varios animales (más de un LOTE o de una RES en las Observaciones): lígelo a mano');

  return {
    tipo, numero: numeroDoc, fecha, hora,
    bodega_origen: bodega(lineas, /^bodega\s+(?:de\s+)?origen\b/i),
    bodega_destino: bodega(lineas, /^bodega\s+(?:de\s+)?destino\b/i),
    estado: mEstado ? mEstado[1].slice(0, 30) : null,
    observaciones, ...lr,
    lineas: lineasDoc, total_cajas: totalCajas, total_kg: totalKg, suma_cajas: sumaCajas, suma_kg: sumaKg, avisos,
  };
}

module.exports = { parsearDocumentoCustodia, lineaArticulo, loteYRes, fechaHora, TIPOS };
