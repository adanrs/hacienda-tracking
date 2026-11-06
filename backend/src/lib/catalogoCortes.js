// Catálogo de cortes en memoria: la BASE manda, el archivo data/catalogo-ciisa.js es el respaldo.
//
// Por qué un caché y no una consulta por etiqueta: el decodificador de etiquetas (lib/etiquetas.js)
// es una función pura y síncrona que se usa en lotes (escaneos, integración con la tienda, pruebas
// sin MySQL). Hacerla asíncrona obligaría a cambiar todos sus llamadores. En vez de eso:
//   - al arrancar (y después de cada alta/edición/importación del catálogo) se recarga el mapa
//     código → corte desde `catalogo_cortes`;
//   - si la base todavía no se leyó (pruebas puras, arranque sin MySQL) o el código no está en la
//     base, se usa el archivo, que era la única fuente antes de este cambio.
// Así un código que el dueño da de alta en la pantalla lo reconoce el decodificador al instante,
// y nada se rompe si la base no está disponible.

const { CATALOGO_POR_CODIGO } = require('../data/catalogo-ciisa');

/** Código genérico para lo que la planta trae sin código conocido (se reasigna después). */
const CODIGO_PENDIENTE = '99';
const NOMBRE_PENDIENTE = 'Corte pendiente de codificar';

let porCodigo = null; // Map codigo → fila de catalogo_cortes (null = aún no se leyó la base)

/** Relee el catálogo desde MySQL. Nunca lanza: si falla, se sigue con lo que había. */
async function recargar(db) {
  try {
    const [filas] = await db.query(
      'SELECT id, codigo, nombre, nombre_en, tipo, serie, genetica, unidad, activo, vida_util_dias, vida_congelado_dias FROM catalogo_cortes',
    );
    porCodigo = new Map(filas.map((f) => [String(f.codigo), { ...f, activo: Number(f.activo) === 1 }]));
    return porCodigo.size;
  } catch (e) {
    console.error('[catalogo] no se pudo recargar el catálogo de la base; se usa el archivo:', e.message);
    return null;
  }
}

/** Corte por código: base primero, luego archivo. `origen` dice de dónde salió. */
function buscar(codigo) {
  const c = String(codigo == null ? '' : codigo).trim();
  if (!c) return null;
  if (porCodigo && porCodigo.has(c)) return { ...porCodigo.get(c), origen: 'base' };
  const archivo = CATALOGO_POR_CODIGO[c];
  if (archivo) return { ...archivo, activo: true, origen: 'archivo' };
  return null;
}

/** Solo para pruebas: vuelve al estado «sin base leída». */
function olvidar() { porCodigo = null; }

/** Para pruebas: fija el catálogo de la base sin MySQL. */
function fijar(filas) { porCodigo = new Map(filas.map((f) => [String(f.codigo), { activo: true, ...f }])); }

module.exports = { recargar, buscar, olvidar, fijar, CODIGO_PENDIENTE, NOMBRE_PENDIENTE };
