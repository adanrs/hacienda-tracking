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
//
// Formato REAL del PDF de CIISA (deshuese del 19-mar-2026, 5 PDF en test/fixtures/deshuese-19-03-2026):
// pdf-parse lo saca POR COLUMNAS y con las etiquetas después del valor:
//   Fecha de Produccion:\n19/03/26
//   1Num. LoteTEMPISQUETipo Produccion:\n34        ← Num. Lote 1, tipo TEMPISQUE, 34 = total de cajas
//   11163\n21114\n… Articulo  BEEF TRIMMINGS\n…  133.06\n… Peso  KGS\n… Unidad  5\n… Cajas
//   Total de Cajas por el Lote # 1\n 35Lote CC\n 893.97 405.50KilosLibras   ← Lote CC 35, lb y kg
// OJO: «Num. Lote» es el correlativo del PDF dentro del día (1, 2, 3…) y «Lote CC» es el lote de
// deshuese: el que viene impreso en las etiquetas (2 dígitos en el primal, 4 en la caja: 0035), en
// el traslado de custodia («LOTE 35») y en la tabla Lote CC → arete del correo. El arete se liga por
// Lote CC; Num. Lote queda solo como dato informativo.

const { parsearFecha } = require('./texto');

const RE_TITULO = /REPORTE\s+DIARIO\s+DE\s+PRODUCCI[OÓ]N/i;
const RE_FECHA = /Fecha\s+de\s+Producci[oó]n\s*:?\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/i;
// Cada etiqueta del encabezado se busca con el número DESPUÉS («Num. Lote 2», «Lote CC02») y, si no,
// ANTES («1Num. Lote», « 35Lote CC», como sale el PDF real). El número de después no puede ser parte
// de un decimal: en el PDF real a «Lote CC» le sigue la línea de libras («Lote CC\n 893.97»).
const RE_NUM_LOTE = /Num\.?\s*Lote\s*:?\s*(\d{1,4})(?![\d.,])/i;
const RE_NUM_LOTE_ANTES = /(?<![\d.,])(\d{1,4})[ \t]*Num\.?\s*Lote/i;
const RE_LOTE_CC = /Lote\s*CC\s*:?\s*(\d{1,4})(?![\d.,])/i;
const RE_LOTE_CC_ANTES = /(?<![\d.,#])(\d{1,4})[ \t]*Lote\s*CC/i;
// El tipo empieza con letra (si no, en el PDF real tomaría el total de cajas de la línea siguiente).
const RE_TIPO = /Tipo\s+Producci[oó]n[ \t]*:?[ \t]*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ]*?)[ \t]*(?:$|\n|Lote\s+CC)/i;
const RE_TIPO_ANTES = /Lote[ \t]*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 ]*?)[ \t]*Tipo\s+Producci[oó]n/;
// Línea de artículo: 5 dígitos, descripción, peso con 2 decimales (miles con coma opcional), unidad, cajas.
const RE_LINEA = /^\s*(\d{5})\s*(.*?)\s*(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*(KGS|KG|KILOS)\s*(\d{1,4})\s*$/i;
// Pie: «Total de Cajas por el Lote # 2 Libras 773.42 Kilos 350.82 31».
const RE_PIE = /Total\s+de\s+Cajas\s+por\s+el\s+Lote\s*#?\s*(\d{1,4})\s*Libras\s*([\d,]*\d\.\d{2})\s*Kilos\s*([\d,]*\d\.\d{2})\s*(\d{1,5})/i;
// Pie del PDF real: «Total de Cajas por el Lote # 1 35Lote CC 893.97 405.50KilosLibras» (con los saltos
// como espacios). Las cajas no vienen aquí sino tras «Tipo Produccion:» (RE_CAJAS_COLUMNAS).
const RE_PIE_COLUMNAS = /Total\s+de\s+Cajas\s+por\s+el\s+Lote\s*#?\s*(\d{1,4})\s*(?:\d{1,4}\s*Lote\s*CC\s*)?([\d,]*\d\.\d{2})\s+([\d,]*\d\.\d{2})\s*Kilos\s*Libras/i;
const RE_CAJAS_COLUMNAS = /Tipo\s+Producci[oó]n\s*:?[ \t]*\n\s*(\d{1,5})\s*\n/i;
const RE_PESO = /^(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})$/;

const numero = (s) => Number(String(s).replace(/,/g, ''));

/** Parte un texto en bloques, uno por reporte (por el título; sin título = un solo bloque). */
function bloques(texto) {
  const t = String(texto || '').replace(/\r/g, '');
  const partes = t.split(RE_TITULO);
  if (partes.length <= 1) return t.trim() ? [t] : [];
  return partes.slice(1).filter((p) => p.trim());
}

/**
 * Líneas del PDF real, que pdf-parse saca por columnas: N códigos, «Articulo», N descripciones,
 * N pesos, «Peso», N unidades, «Unidad», N cajas, «Cajas». Devuelve null si el texto no tiene esa
 * forma, o { lineas } / { error } si la tiene (columnas descuadradas = error, nunca se adivina).
 */
function lineasEnColumnas(texto) {
  const L = texto.split('\n').map((x) => x.trim());
  const iArt = L.findIndex((x) => /^Art[ií]culo$/i.test(x));
  if (iArt < 0) return null;
  const codigos = [];
  for (let i = iArt - 1; i >= 0 && /^\d{5}$/.test(L[i]); i--) codigos.unshift(L[i]);
  const n = codigos.length;
  if (!n) return null;
  const tramo = (desde) => L.slice(desde, desde + n);
  const desc = tramo(iArt + 1);
  let k = iArt + 1 + n;
  const pesos = tramo(k); k += n;
  const okPeso = L[k] === 'Peso'; k += 1;
  const unidades = tramo(k); k += n;
  const okUnidad = L[k] === 'Unidad'; k += 1;
  const cajas = tramo(k); k += n;
  const okCajas = L[k] === 'Cajas';
  if (!okPeso || !okUnidad || !okCajas || !pesos.every((p) => RE_PESO.test(p))
    || !unidades.every((u) => /^(KGS|KG|KILOS)$/i.test(u)) || !cajas.every((c) => /^\d{1,4}$/.test(c))) {
    return { error: `Las columnas del PDF no cuadran (${n} códigos de artículo): revise el reporte o cárguelo por foto` };
  }
  return {
    lineas: codigos.map((c, i) => ({
      articulo_codigo: c,
      descripcion: desc[i].replace(/\s+/g, ' ').trim() || null,
      peso_kg: numero(pesos[i]),
      unidad: 'KGS',
      cajas: Number(cajas[i]),
    })),
  };
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
  const mLote = RE_NUM_LOTE.exec(texto) || RE_NUM_LOTE_ANTES.exec(texto);
  const mCC = RE_LOTE_CC.exec(texto) || RE_LOTE_CC_ANTES.exec(texto);
  const mTipo = RE_TIPO.exec(texto) || RE_TIPO_ANTES.exec(texto);
  // Sin Lote CC no se puede ligar el arete (ni guardar el reporte, cuya llave es fecha + Lote CC):
  // ya NO se toma el Num. Lote en su lugar, que es justo lo que ligaba al animal equivocado.
  if (!mCC) errores.push('No se encontró el «Lote CC» (lote de deshuese): sin él no se puede ligar el arete');

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
  if (!lineas.length) {
    const col = lineasEnColumnas(texto);
    if (col && col.error) errores.push(col.error);
    else if (col) lineas.push(...col.lineas);
    else errores.push('No se encontraron líneas de artículos (código de 5 dígitos, peso, KGS, cajas)');
  }

  // El pie puede venir partido en dos líneas al pegar: se busca sobre el texto con los saltos como espacios.
  const plano = texto.replace(/\n/g, ' ');
  const mPie = RE_PIE.exec(plano);
  let pie = mPie ? { lote: mPie[1], libras: numero(mPie[2]), kilos: numero(mPie[3]), cajas: Number(mPie[4]) } : null;
  if (!pie) {
    const mCol = RE_PIE_COLUMNAS.exec(plano);
    const mCajas = RE_CAJAS_COLUMNAS.exec(texto);
    if (mCol && mCajas) {
      // Las etiquetas salen «KilosLibras» pero los valores en otro orden: las libras son siempre el mayor.
      const a = numero(mCol[2]);
      const b = numero(mCol[3]);
      pie = { lote: mCol[1], libras: Math.max(a, b), kilos: Math.min(a, b), cajas: Number(mCajas[1]) };
    }
  }
  if (!pie) errores.push('No se encontró el pie «Total de Cajas por el Lote» (libras, kilos y cajas)');

  return {
    fecha,
    fecha_texto: mFecha ? mFecha[1] : null,
    num_lote: mLote ? String(Number(mLote[1])) : (pie ? String(Number(pie.lote)) : null),
    lote_cc: mCC ? Number(mCC[1]) : null,
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
 * Lista Lote CC → arete del correo («06 225MLE», «07	348MLF», «Lote 8: 81FLB»): la clave es el
 * LOTE CC del reporte (el lote de deshuese de las etiquetas), NO el Num. Lote. Ignora saludos y
 * líneas que no tengan exactamente un número de lote y un arete.
 * @returns {{ mapa: Map<string,string>, repetidos: string[] }}  clave = Lote CC sin ceros a la izquierda
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
