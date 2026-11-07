// BMS de una caja / línea de inventario: sale del MARMOLEO DEL ANIMAL, nunca de la etiqueta de caja.
//
// Historia: el 06-nov-2026 se tomaron los 2 últimos dígitos del código de caja CIISA como BMS. Juan
// Carlos lo corrigió el 07-nov-2026: son un sufijo de la caja de deshuese de significado desconocido
// (en INV WAGYU #10, 246 de 310 cajas terminan en «11», incluidas molida y tortas sin marmoleo;
// «10» en primales, 51–56 en BCH/trimming). Ahora:
//   - BOLSA (28): el BMS viene impreso en las posiciones 27–28 (eso no cambió) y se compara con el
//     marmoleo del animal como aviso (compararBmsEtiqueta).
//   - CAJA, PRIMAL, lote de maduración, línea sin código: el BMS es el marmoleo medido en la canal
//     del animal (cámara AUS-MEAT, pantalla Marmoleo → `sacrificios.marmoleo`) al que traza la línea
//     (arete impreso, o fecha de deshuese + Lote CC → reporte de producción: lib/trazabilidadEtiqueta.js).
//     Sin animal o sin marmoleo medido → null (la tienda la muestra sin banda).
//
// OJO escala: la cámara mide AUS-MEAT 0–9 y la tienda usa BMS 0–12. Mientras no haya tabla de
// conversión, el número AUS-MEAT se usa tal cual como BMS (decisión de negocio pendiente).

const { compararConEtiqueta } = require('./importador/procesadores/marmoleoCamara');
const { marcas } = require('./importador/comun');
const { decodificar, normalizar } = require('./etiquetas');

/**
 * PURO. BMS impreso en una bolsa contra el marmoleo medido del animal. null si falta uno de los dos.
 * Si no: { estado: 'coincide' | 'no_cuadra' | 'no_comparable', marmoleo_animal, aviso }
 */
function compararBmsEtiqueta(bms, marmoleoAnimal) {
  if (bms == null || marmoleoAnimal == null || Number.isNaN(Number(bms)) || Number.isNaN(Number(marmoleoAnimal))) return null;
  const c = compararConEtiqueta(Number(marmoleoAnimal), Number(bms));
  const estado = !c.comparable ? 'no_comparable' : c.coincide ? 'coincide' : 'no_cuadra';
  return { estado, marmoleo_animal: Number(marmoleoAnimal), aviso: c.aviso || null };
}

/**
 * Marmoleo medido por animal: { porAnimal: Map(animal_id → n), porArete: Map(arete → n) }.
 * Una sola consulta por lista (no por caja). Si un animal tuviera dos sacrificios con marmoleo,
 * vale el último registrado.
 */
async function marmoleosDe(db, { animalIds = [], aretes = [] } = {}) {
  const ids = [...new Set(animalIds.filter((x) => x != null).map(Number))];
  const ars = [...new Set(aretes.filter(Boolean).map(String))];
  const porAnimal = new Map();
  const porArete = new Map();
  if (!ids.length && !ars.length) return { porAnimal, porArete };
  const cond = [];
  const params = [];
  if (ids.length) { cond.push(`s.animal_id IN (${marcas(ids.length)})`); params.push(...ids); }
  if (ars.length) { cond.push(`a.numero_trazabilidad IN (${marcas(ars.length)})`); params.push(...ars); }
  const [filas] = await db.query(
    `SELECT s.animal_id, a.numero_trazabilidad AS arete, s.marmoleo
       FROM sacrificios s JOIN animales a ON a.id = s.animal_id
      WHERE s.marmoleo IS NOT NULL AND (${cond.join(' OR ')})
      ORDER BY s.id`, params);
  for (const f of filas) {
    porAnimal.set(Number(f.animal_id), Number(f.marmoleo));
    if (f.arete) porArete.set(String(f.arete), Number(f.marmoleo));
  }
  return { porAnimal, porArete };
}

/** Marmoleo del animal de una línea (por animal_id; si no, por arete). */
function marmoleoDeLinea(m, l) {
  if (l.animal_id != null && m.porAnimal.has(Number(l.animal_id))) return m.porAnimal.get(Number(l.animal_id));
  if (l.arete && m.porArete.has(String(l.arete))) return m.porArete.get(String(l.arete));
  return null;
}

/**
 * PURO. BMS de una línea a partir de su código y del marmoleo de su animal (o null).
 *   bolsa  → { bms: el impreso, origen: 'etiqueta', comparacion con el animal (o null) }
 *   resto  → { bms: marmoleo del animal o null, origen: 'animal' | null, comparacion: null }
 * El sufijo de la caja (pos. 24–25) NUNCA se usa.
 */
function bmsDeLinea(codigo, marmoleoAnimal) {
  const animal = marmoleoAnimal == null || Number.isNaN(Number(marmoleoAnimal)) ? null : Number(marmoleoAnimal);
  const d = codigo ? decodificar(normalizar(codigo)) : null;
  if (d && d.tipo === 'paquete') {
    const impreso = d.campos && d.campos.marmoleo != null ? Number(d.campos.marmoleo) : null;
    if (impreso != null) return { bms: impreso, origen: 'etiqueta', comparacion: compararBmsEtiqueta(impreso, animal) };
  }
  return { bms: animal, origen: animal == null ? null : 'animal', comparacion: null };
}

/**
 * BMS vivo de varias líneas (una consulta). Cada línea trae su código (`campoCodigo`), y
 * `animal_id` y/o `arete`. Devuelve un arreglo paralelo con el resultado de bmsDeLinea.
 * Vivo = se calcula al leer: si el marmoleo del animal se carga después del inventario o del
 * traslado, igual aparece; y lo que se guardó del sufijo de caja antes del 07-nov no se usa.
 */
async function bmsVivo(db, lineas, campoCodigo = 'codigo_barras') {
  const m = await marmoleosDe(db, { animalIds: lineas.map((l) => l.animal_id), aretes: lineas.map((l) => l.arete) });
  return lineas.map((l) => bmsDeLinea(l[campoCodigo], marmoleoDeLinea(m, l)));
}

module.exports = { compararBmsEtiqueta, marmoleosDe, marmoleoDeLinea, bmsDeLinea, bmsVivo };
