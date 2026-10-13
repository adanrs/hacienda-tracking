const router = require('express').Router();
const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos, normalizarFechaIso } = require('../lib/sqlUpdate');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM sacrificios s JOIN animales a ON s.animal_id = a.id
      ORDER BY s.fecha DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM sacrificios s JOIN animales a ON s.animal_id = a.id
      WHERE s.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio, notas, numero_mag, lote_mag, tara_kg, cuenta, ruta, tipo_pasaje, musculo, denticion, encarnada, golpe, ph_24h, temp_24h } = req.body;
  if (!animal_id || !fecha) {
    return res.status(400).json({ error: 'animal_id y fecha son requeridos' });
  }
  const rendimiento_canal = (peso_vivo && peso_canal_frio) ? parseFloat(((peso_canal_frio / peso_vivo) * 100).toFixed(2)) : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`
      INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, rendimiento_canal, marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio, notas, numero_mag, lote_mag, tara_kg, cuenta, ruta, tipo_pasaje, musculo, denticion, encarnada, golpe, ph_24h, temp_24h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [animal_id, fecha, peso_vivo || null, peso_canal_caliente || null, peso_canal_frio || null, rendimiento_canal, marmoleo || null, ojo_ribeye_cm2 || null, fecha_marmoleo || null, fecha_colgado || null, inspector, resultado_inspeccion || 'aprobado', lote_sacrificio, notas, numero_mag || null, lote_mag || null, tara_kg || null, cuenta || null, ruta || null, tipo_pasaje || null, musculo || null, denticion || null, encarnada || null, golpe || null, ph_24h || null, temp_24h || null]);
    await conn.query("UPDATE animales SET estado = 'sacrificado' WHERE id = ?", [animal_id]);
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este animal ya tiene un registro de sacrificio' });
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// rendimiento_canal no está en la lista: lo calcula el servidor (abajo) a partir de los pesos.
const SACRIFICIO_EDITABLES = [
  'fecha', 'peso_vivo', 'peso_canal_caliente', 'peso_canal_frio',
  'marmoleo', 'ojo_ribeye_cm2', 'fecha_marmoleo', 'fecha_colgado', 'inspector',
  'resultado_inspeccion', 'lote_sacrificio', 'notas',
  'numero_mag', 'lote_mag', 'tara_kg', 'cuenta', 'ruta',
  'tipo_pasaje', 'musculo', 'denticion', 'encarnada', 'golpe', 'ph_24h', 'temp_24h',
];
const SACRIFICIO_ENUMS = { resultado_inspeccion: ['aprobado', 'rechazado', 'condicionado'] };
// Solo las columnas DATETIME pasan por la conversión ISO -> MySQL (antes se aplicaba a
// cualquier texto, incluidas notas que empezaran con una fecha).
const SACRIFICIO_FECHAS = new Set(['fecha', 'fecha_marmoleo', 'fecha_colgado']);
const normalizarSacrificio = (col, v) => (SACRIFICIO_FECHAS.has(col) ? normalizarFechaIso(v) : v);

router.put('/:id', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? { ...req.body } : req.body;
    delete body?.rendimiento_canal;
    let permitidas = SACRIFICIO_EDITABLES;

    // Recalcula rendimiento_canal si cambian los pesos que lo definen.
    if (body && (body.peso_vivo || body.peso_canal_frio)) {
      const [existing] = await pool.query('SELECT peso_vivo, peso_canal_frio FROM sacrificios WHERE id = ?', [req.params.id]);
      if (existing.length) {
        const pv = body.peso_vivo || existing[0].peso_vivo;
        const pcf = body.peso_canal_frio || existing[0].peso_canal_frio;
        if (pv && pcf) {
          body.rendimiento_canal = parseFloat(((pcf / pv) * 100).toFixed(2));
          permitidas = [...SACRIFICIO_EDITABLES, 'rendimiento_canal'];
        }
      }
    }

    const { sql, params } = construirUpdate({
      tabla: 'sacrificios', id: req.params.id, body,
      permitidas, enums: SACRIFICIO_ENUMS, normalizar: normalizarSacrificio,
    });
    await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/marmoleo', async (req, res) => {
  const { marmoleo, ojo_ribeye_cm2, fecha_marmoleo, musculo, denticion, encarnada, golpe, ph_24h, temp_24h } = req.body;
  if (marmoleo == null) return res.status(400).json({ error: 'marmoleo es requerido' });
  try {
    const [result] = await pool.query(
      'UPDATE sacrificios SET marmoleo = ?, ojo_ribeye_cm2 = ?, fecha_marmoleo = ?, musculo = ?, denticion = ?, encarnada = ?, golpe = ?, ph_24h = ?, temp_24h = ? WHERE id = ?',
      [marmoleo, ojo_ribeye_cm2 || null, fecha_marmoleo || new Date(), musculo || null, denticion || null, encarnada || null, golpe || null, ph_24h || null, temp_24h || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM sacrificios WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json({ message: 'Sacrificio eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
