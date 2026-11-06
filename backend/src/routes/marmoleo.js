// Marmoleo por canal (etapa entre Sacrificio y Solicitud de deshuese).
//
//   GET /api/marmoleo?fecha=AAAA-MM-DD  → canales sacrificadas ese día con su marmoleo AUS-MEAT
//   GET /api/marmoleo/fechas            → días con sacrificios (y cuántas canales falta medir)
//   PUT /api/marmoleo                   → { fecha_marmoleo?, mediciones: [{ sacrificio_id, marmoleo }] }
//
// Captura manual simple: un solo dato por canal, «Marmoleo AUS-MEAT» (entero 0–9). La carga
// desde la cámara (pegar la tabla de la página) va por /api/importaciones/marmoleo-camara.
// No se puede medir sin sacrificio: solo se actualizan filas de `sacrificios` que existan.

const router = require('express').Router();
const { pool } = require('../models/database');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILAS = 200;
const FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})( ([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?)?$/;

function fechaHoraValida(v) {
  const m = FECHA_HORA.exec(String(v));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

router.get('/fechas', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(s.fecha_dia, '%Y-%m-%d') AS fecha, COUNT(*) AS canales, SUM(s.marmoleo IS NULL) AS sin_medir
       FROM sacrificios s GROUP BY s.fecha_dia ORDER BY s.fecha_dia DESC LIMIT 60`);
    res.json(rows.map(r => ({ ...r, sin_medir: Number(r.sin_medir) })));
  } catch (err) { console.error('[marmoleo]', err); res.status(500).json({ error: 'No se pudieron cargar las fechas' }); }
});

router.get('/', async (req, res) => {
  const fecha = String(req.query.fecha || '');
  if (!FECHA.test(fecha)) return res.status(400).json({ error: 'Parámetro fecha inválido: use AAAA-MM-DD' });
  try {
    const [rows] = await pool.query(
      `SELECT s.id AS sacrificio_id, s.animal_id, s.numero_canal, a.numero_trazabilidad AS arete, s.peso_vivo, s.peso_canal_caliente,
              s.marmoleo, DATE_FORMAT(s.fecha_marmoleo, '%Y-%m-%d %H:%i') AS fecha_marmoleo, s.marmoleo_extra IS NOT NULL AS desde_camara,
              u.nombre AS medido_por
       FROM sacrificios s JOIN animales a ON a.id = s.animal_id LEFT JOIN usuarios u ON u.id = s.marmoleo_por
       WHERE s.fecha_dia = ? ORDER BY CAST(s.numero_canal AS UNSIGNED), s.numero_canal, a.numero_trazabilidad`, [fecha]);
    res.json(rows.map(r => ({ ...r, desde_camara: !!r.desde_camara })));
  } catch (err) { console.error('[marmoleo]', err); res.status(500).json({ error: 'No se pudo cargar el marmoleo' }); }
});

router.put('/', async (req, res) => {
  const { mediciones, fecha_marmoleo } = req.body || {};
  if (!Array.isArray(mediciones) || !mediciones.length) return res.status(400).json({ error: 'Envíe al menos una medición' });
  if (mediciones.length > MAX_FILAS) return res.status(400).json({ error: `Máximo ${MAX_FILAS} canales por envío` });
  // Se valida el valor COMPLETO (antes solo los 10 primeros caracteres: «2026-08-20xyz» llegaba a
  // MySQL y respondía 500) y que la fecha exista (no 2026-13-45).
  if (fecha_marmoleo != null && fecha_marmoleo !== '' && !fechaHoraValida(fecha_marmoleo)) {
    return res.status(400).json({ error: 'fecha_marmoleo inválida: use AAAA-MM-DD o AAAA-MM-DD HH:MM[:SS]' });
  }
  const errores = [];
  const limpias = [];
  for (const [i, m] of mediciones.entries()) {
    const id = Number(m && m.sacrificio_id);
    const v = m && m.marmoleo;
    if (!Number.isInteger(id) || id < 1) { errores.push(`Fila ${i + 1}: sacrificio inválido`); continue; }
    if (v === null || v === '') { limpias.push({ id, v: null }); continue; } // vaciar una medición mal digitada
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 9) { errores.push(`Fila ${i + 1}: el marmoleo AUS-MEAT es un entero de 0 a 9`); continue; }
    limpias.push({ id, v: n });
  }
  if (errores.length) return res.status(400).json({ error: errores[0], detalles: errores });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let n = 0;
    for (const { id, v } of limpias) {
      const [r] = await conn.query(
        `UPDATE sacrificios SET marmoleo = ?, fecha_marmoleo = IF(? IS NULL, NULL, COALESCE(?, fecha_marmoleo, NOW())), marmoleo_por = ?
         WHERE id = ? AND (? IS NULL OR DATE(?) >= fecha_dia)`,
        [v, v, fecha_marmoleo || null, req.user && req.user.id ? req.user.id : null, id, fecha_marmoleo || null, fecha_marmoleo || null]);
      if (!r.affectedRows) throw Object.assign(new Error(`El sacrificio ${id} no existe o la fecha de medición es anterior al sacrificio`), { status: 400 });
      n += r.affectedRows;
    }
    await conn.commit();
    res.json({ actualizados: n });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[marmoleo]', err);
    res.status(500).json({ error: 'No se pudo guardar el marmoleo' });
  } finally { conn.release(); }
});

router.fechaHoraValida = fechaHoraValida; // para las pruebas
module.exports = router;
