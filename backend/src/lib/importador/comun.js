// Piezas compartidas por los procesadores del importador.

const { normalizarArete } = require('./texto');

/** Placeholders «?, ?, ?» para un IN (nunca vacío: el llamador debe evitar listas vacías). */
const marcas = (n) => Array.from({ length: n }, () => '?').join(', ');

/** Convierte un DECIMAL de mysql2 (texto) a número o null. */
const num = (v) => (v == null || v === '' ? null : Number(v));

/** Igualdad para comparar «antes» y «después» (números con tolerancia de centésimas). */
function iguales(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 0.005;
  return String(a) === String(b);
}

const fmtFechaSql = (col, alias) => `DATE_FORMAT(${col}, '%Y-%m-%d') AS ${alias}`;

/** Fecha AAAA-MM-DD → dd/mm/aaaa para mensajes. */
const fechaTexto = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

/** Clave normalizada de un arete para comparar (sin espacios ni guiones: «438-HF» = «438HF»). */
const claveArete = (v) => normalizarArete(v).replace(/[\s-]/g, '');

/**
 * Documentos de un mismo texto (varias fotos leídas seguidas, un PDF con varias guías), para los
 * formatos de documentos sueltos (guía del MAG, custodia CIISA). Cada documento empieza en una línea
 * que cumple `reInicio` (el membrete: «SERVICIO NACIONAL DE SALUD ANIMAL», «CENTRO INTERNACIONAL DE
 * INVERSIONES»). Luego se parsea cada pedazo y `unir` junta los consecutivos que son el mismo
 * documento (la página 2 repite el membrete y el número).
 * @returns {string[]} los pedazos de texto, en orden (al menos uno)
 */
function partirDocumentos(texto, reInicio) {
  const lineas = String(texto || '').split('\n');
  const pedazos = [];
  let actual = [];
  for (const l of lineas) {
    if (reInicio.test(l) && actual.some((x) => x.trim())) { pedazos.push(actual.join('\n')); actual = []; }
    actual.push(l);
  }
  if (actual.some((x) => x.trim()) || !pedazos.length) pedazos.push(actual.join('\n'));
  return pedazos;
}

/**
 * Parsea cada pedazo y une los consecutivos con la misma clave (misma guía / mismo documento en
 * dos páginas): el texto se concatena y se parsea de nuevo.
 */
function documentosDelTexto(texto, reInicio, parsear, clave) {
  const salida = [];
  for (const pedazo of partirDocumentos(texto, reInicio)) {
    const p = parsear(pedazo);
    const previo = salida[salida.length - 1];
    if (previo && clave(p) && clave(p) === clave(previo.datos)) {
      previo.texto += `\n${pedazo}`;
      previo.datos = parsear(previo.texto);
    } else salida.push({ texto: pedazo, datos: p });
  }
  return salida.map((x) => x.datos);
}

module.exports = { marcas, num, iguales, fmtFechaSql, fechaTexto, claveArete, partirDocumentos, documentosDelTexto };
