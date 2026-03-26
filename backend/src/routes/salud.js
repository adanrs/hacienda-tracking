const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { animal_id, tipo, desde, hasta } = req.query;
  let sql = `SELECT e.*, a.numero_trazabilidad, a.nombre as animal_nombre FROM eventos_salud e JOIN animales a ON e.animal_id = a.id WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND e.animal_id = ?`; params.push(animal_id); }
  if (tipo) { sql += ` AND e.tipo = ?`; params.push(tipo); }
  if (desde) { sql += ` AND e.fecha >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND e.fecha <= ?`; params.push(hasta); }
  sql += ` ORDER BY e.fecha DESC`;
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { animal_id, tipo, fecha, descripcion, producto, dosis, veterinario, costo, proxima_fecha, notas } = req.body;
  if (!animal_id || !tipo || !fecha || !descripcion) {
    return res.status(400).json({ error: 'animal_id, tipo, fecha y descripcion son requeridos' });
  }
  try {
    const [result] = await pool.query(`
      INSERT INTO eventos_salud (animal_id, tipo, fecha, descripcion, producto, dosis, veterinario, costo, proxima_fecha, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [animal_id, tipo, fecha, descripcion, producto, dosis, veterinario, costo || 0, proxima_fecha || null, notas]);
    const [rows] = await pool.query('SELECT * FROM eventos_salud WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM eventos_salud WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json({ message: 'Evento eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/alertas/proximas', async (req, res) => {
  const dias = req.query.dias || 30;
  try {
    const [rows] = await pool.query(`
      SELECT e.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM eventos_salud e JOIN animales a ON e.animal_id = a.id
      WHERE e.proxima_fecha IS NOT NULL AND e.proxima_fecha <= DATE_ADD(CURDATE(), INTERVAL ? DAY) AND e.proxima_fecha >= CURDATE()
      ORDER BY e.proxima_fecha ASC
    `, [parseInt(dias)]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
