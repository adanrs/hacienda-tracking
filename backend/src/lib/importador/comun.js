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

module.exports = { marcas, num, iguales, fmtFechaSql, fechaTexto, claveArete };
