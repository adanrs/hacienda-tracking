const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { hembra_id, resultado } = req.query;
  let sql = `
    SELECT r.*, h.numero_trazabilidad as hembra_trazabilidad, h.nombre as hembra_nombre,
      m.numero_trazabilidad as macho_trazabilidad, m.nombre as macho_nombre,
      c.numero_trazabilidad as cria_trazabilidad, c.nombre as cria_nombre
    FROM reproduccion r
    JOIN animales h ON r.hembra_id = h.id
    LEFT JOIN animales m ON r.macho_id = m.id
    LEFT JOIN animales c ON r.cria_id = c.id
    WHERE 1=1`;
  const params = [];
  if (hembra_id) { sql += ` AND r.hembra_id = ?`; params.push(hembra_id); }
  if (resultado) { sql += ` AND r.resultado = ?`; params.push(resultado); }
  sql += ` ORDER BY r.fecha_servicio DESC`;
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { hembra_id, macho_id, tipo, fecha_servicio, fecha_parto_estimada, resultado, notas } = req.body;
  if (!hembra_id || !tipo || !fecha_servicio) return res.status(400).json({ error: 'hembra_id, tipo y fecha_servicio son requeridos' });
  try {
    const [result] = await pool.query(`
      INSERT INTO reproduccion (hembra_id, macho_id, tipo, fecha_servicio, fecha_parto_estimada, resultado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [hembra_id, macho_id || null, tipo, fecha_servicio, fecha_parto_estimada || null, resultado || 'gestante', notas]);
    const [rows] = await pool.query('SELECT * FROM reproduccion WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id');
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE reproduccion SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM reproduccion WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM reproduccion WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Registro eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
