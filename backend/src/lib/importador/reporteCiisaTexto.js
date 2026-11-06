// Lector del texto del «REPORTE DIARIO DE PRODUCCION» de CIISA (un PDF = un animal = un lote).
//
// Entrada: el texto que saca pdf-parse del PDF, o lo que el usuario pegue (copiado del PDF o del
// correo). pdf-parse junta los textos de una misma línea SIN espacios («11163BEEF TRIMMINGS27.22KGS1»,
// «Total de Cajas por el Lote #2Libras773.42Kilos350.8231»), así que los patrones no dependen de los
// espacios: se apoyan en que el artículo tiene 5 dígitos al inicio, el peso SIEMPRE 2 decimales,
// la unidad es KGS y las cajas un entero al final. Un texto puede traer varios reportes seguidos
// (pegar dos PDF): se parte por el título.
//
// Formato (captura del correo del 05-nov-2026):
//   REPORTE DIARIO DE PRODUCCION
//   Fecha de Produccion: 19/10/26
//   Num. Lote 2   Tipo Produccion: TEMPISQUE
//   Lote CC 02
//   Articulo  Peso  Unidad  Cajas
//   11163  BEEF TRIMMINGS  27.22  KGS  1   … (una línea por artículo)
//   Total de Cajas por el Lote #  2  Libras 773.42  Kilos 350.82  31

const { parsearFecha } = require('./texto');

const RE_TITULO = /REPORTE\s+DIARIO\s+DE\s+PRODUCCI[OÓ]N/i;
const RE_FECHA = /Fecha\s+de\s+Producci[oó]n\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i;
const RE_NUM_LOTE = /Num\.?\s*Lote\s*:?\s*(\d{1,4})/i;
const RE_TIPO = /Tipo\s+Producci[oó]n\s*:?\s*([A-ZÁÉÍÓÚÑ0-9 ]+?)\s*(?:$|\n|Lote\s+CC)/i;
const RE_LOTE_CC = /Lote\s*CC\s*:?\s*(\d{1,4})/i;
// Línea de artículo: 5 dígitos, descripción, peso con 2 decimales (miles con coma opcional), unidad, cajas.
const RE_LINEA = /^\s*(\d{5})\s*(.*?)\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*(KGS|KG|KILOS)\s*(\d{1,4})\s*$/i;
// Pie: «Total de Cajas por el Lote # 2 Libras 773.42 Kilos 350.82 31».
const RE_PIE = /Total\s+de\s+Cajas\s+por\s+el\s+Lote\s*#?\s*(\d{1,4})\s*Libras\s*([\d,]*\d\.\d{2})\s*Kilos\s*([\d,]*\d\.\d{2})\s*(\d{1,5})/i;

const numero = (s) => Number(String(s).replace(/,/g, ''));

/** Parte un texto en bloques, uno por reporte (por el título; sin título = un solo bloque). */
function bloques(texto) {
  const t = String(texto || '').replace(/\r/g, '');
  const partes = t.split(RE_TITULO);
  if (partes.length <= 1) return t.trim() ? [t] : [];
  return partes.slice(1).filter((p) => p.trim());
}

/**
 * Lee un reporte. Devuelve lo que pudo leer y la lista de problemas de LECTURA (no de negocio):
 * { fecha, num_lote, lote_cc, tipo_produccion, lineas: [{articulo_codigo, descripcion, peso_kg, unidad, cajas}],
 *   pie: { lote, libras, kilos, cajas } | null, errores: [] }
 */
function leerBloque(texto) {
  const errores = [];
  const mFecha = RE_FECHA.exec(texto);
  let fecha = null;
  if (!mFecha) errores.push('No se encontró la «Fecha de Produccion»');
  else {
    const f = parsearFecha(mFecha[1], 'dmy');
    if (typeof f === 'string') fecha = f; else errores.push(`Fecha de producción «${mFecha[1]}» inválida`);
  }
  const mLote = RE_NUM_LOTE.exec(texto);
  const mCC = RE_LOTE_CC.exec(texto);
  const mTipo = RE_TIPO.exec(texto);
  if (!mLote && !mCC) errores.push('No se encontró «Num. Lote» ni «Lote CC»');

  const lineas = [];
  for (const linea of texto.split('\n')) {
    if (RE_PIE.test(linea)) continue;
    const m = RE_LINEA.exec(linea);
    if (!m) continue;
    lineas.push({
      articulo_codigo: m[1],
      descripcion: m[2].replace(/\s+/g, ' ').trim() || null,
      peso_kg: numero(m[3]),
      unidad: 'KGS',
      cajas: Number(m[5]),
    });
  }
  if (!lineas.length) errores.push('No se encontraron líneas de artículos (código de 5 dígitos, peso, KGS, cajas)');

  // El pie puede venir partido en dos líneas al pegar: se busca sobre el texto con los saltos como espacios.
  const mPie = RE_PIE.exec(texto.replace(/\n/g, ' '));
  const pie = mPie ? { lote: mPie[1], libras: numero(mPie[2]), kilos: numero(mPie[3]), cajas: Number(mPie[4]) } : null;
  if (!pie) errores.push('No se encontró el pie «Total de Cajas por el Lote» (libras, kilos y cajas)');

  return {
    fecha,
    fecha_texto: mFecha ? mFecha[1] : null,
    num_lote: mLote ? String(Number(mLote[1])) : (pie ? String(Number(pie.lote)) : null),
    lote_cc: mCC ? Number(mCC[1]) : (mLote ? Number(mLote[1]) : null),
    tipo_produccion: mTipo ? mTipo[1].trim().slice(0, 60) : null,
    lineas,
    pie,
    errores,
  };
}

/** Todos los reportes de un texto. */
function leerReportes(texto) {
  return bloques(texto).map(leerBloque);
}

/**
 * Lista lote → arete del correo («2 225MLE», «3	348MLF», «Lote 4: 81FLB»). Ignora saludos y
 * líneas que no tengan exactamente un número de lote y un arete.
 * @returns {{ mapa: Map<string,string>, repetidos: string[] }}  clave = n.º de lote sin ceros a la izquierda
 */
function leerMapaLotes(texto) {
  const mapa = new Map();
  const repetidos = [];
  for (const crudo of String(texto || '').replace(/\r/g, '').split('\n')) {
    const m = /^\s*(?:lote\s*#?\s*)?(\d{1,4})\s*[:\-–=→>.\t ]\s*([A-Za-z0-9][A-Za-z0-9-]{1,11})\s*$/i.exec(crudo.trim());
    if (!m) continue;
    const lote = String(Number(m[1]));
    const arete = m[2].toUpperCase();
    if (!/[A-Z]/.test(arete) && !/\d/.test(arete)) continue;
    if (mapa.has(lote) && mapa.get(lote) !== arete) repetidos.push(lote);
    mapa.set(lote, arete);
  }
  return { mapa, repetidos };
}

module.exports = { leerReportes, leerBloque, leerMapaLotes, RE_PIE, RE_LINEA };
