// BMS de la caja contra el marmoleo del animal (respuesta de Juan Carlos, 06-nov-2026).
//
// Los 2 últimos dígitos del código de caja CIISA son el BMS (0–12, lib/etiquetas.js). Si el lote de
// deshuese de la caja traza a un arete que ya tiene el marmoleo medido en la canal (cámara AUS-MEAT,
// pantalla Marmoleo → `sacrificios.marmoleo`), se comparan. Nunca bloquea: es un aviso para revisar.
//
// La cámara mide AUS-MEAT 0–9 y la etiqueta trae BMS 0–12. Mientras no haya tabla de conversión se
// usa la misma regla que la etiqueta de bolsa (compararConEtiqueta): hasta 9 se compara el número tal
// cual; 10–12 queda «no comparable».

const { compararConEtiqueta } = require('./importador/procesadores/marmoleoCamara');
const { marcas } = require('./importador/comun');

/**
 * PURO. null si falta uno de los dos datos. Si no:
 *   { estado: 'coincide' | 'no_cuadra' | 'no_comparable', marmoleo_animal, aviso }
 */
function compararBmsCaja(bms, marmoleoAnimal) {
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

module.exports = { compararBmsCaja, marmoleosDe, marmoleoDeLinea };
