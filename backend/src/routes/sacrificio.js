const router = require('express').Router();
const { pool } = require('../models/database');

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
  const { animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio, notas } = req.body;
  if (!animal_id || !fecha) {
    return res.status(400).json({ error: 'animal_id y fecha son requeridos' });
  }
  const rendimiento_canal = (peso_vivo && peso_canal_frio) ? parseFloat(((peso_canal_frio / peso_vivo) * 100).toFixed(2)) : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`
      INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, rendimiento_canal, marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [animal_id, fecha, peso_vivo || null, peso_canal_caliente || null, peso_canal_frio || null, rendimiento_canal, marmoleo || null, ojo_ribeye_cm2 || null, fecha_marmoleo || null, fecha_colgado || null, inspector, resultado_inspeccion || 'aprobado', lote_sacrificio, notas]);
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

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'animal_id');
  if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

  // Recalculate rendimiento_canal if relevant fields are being updated
  if (fields.peso_vivo || fields.peso_canal_frio) {
    const [existing] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [req.params.id]);
    if (existing.length) {
      const pv = fields.peso_vivo || existing[0].peso_vivo;
      const pcf = fields.peso_canal_frio || existing[0].peso_canal_frio;
      if (pv && pcf) {
        fields.rendimiento_canal = parseFloat(((pcf / pv) * 100).toFixed(2));
        if (!keys.includes('rendimiento_canal')) keys.push('rendimiento_canal');
      }
    }
  }

  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE sacrificios SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/marmoleo', async (req, res) => {
  const { marmoleo, ojo_ribeye_cm2, fecha_marmoleo } = req.body;
  if (marmoleo == null) return res.status(400).json({ error: 'marmoleo es requerido' });
  try {
    const [result] = await pool.query(
      'UPDATE sacrificios SET marmoleo = ?, ojo_ribeye_cm2 = ?, fecha_marmoleo = ? WHERE id = ?',
      [marmoleo, ojo_ribeye_cm2 || null, fecha_marmoleo || new Date(), req.params.id]
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
