const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { sacrificio_id, animal_id } = req.query;
  let sql = `SELECT c.*, a.numero_trazabilidad, a.nombre as animal_nombre
    FROM cortes c JOIN animales a ON c.animal_id = a.id WHERE 1=1`;
  const params = [];
  if (sacrificio_id) { sql += ` AND c.sacrificio_id = ?`; params.push(sacrificio_id); }
  if (animal_id) { sql += ` AND c.animal_id = ?`; params.push(animal_id); }
  sql += ` ORDER BY c.created_at DESC`;
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { sacrificio_id, animal_id, tipo_corte, peso_kg, calidad, destino, lote_empaque, fecha_empaque, notas } = req.body;
  if (!sacrificio_id || !animal_id || !tipo_corte || !peso_kg) {
    return res.status(400).json({ error: 'sacrificio_id, animal_id, tipo_corte y peso_kg son requeridos' });
  }
  try {
    const [result] = await pool.query(`
      INSERT INTO cortes (sacrificio_id, animal_id, tipo_corte, peso_kg, calidad, destino, lote_empaque, fecha_empaque, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [sacrificio_id, animal_id, tipo_corte, peso_kg, calidad || 'primera', destino, lote_empaque, fecha_empaque || null, notas]);
    const [rows] = await pool.query('SELECT * FROM cortes WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM cortes WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json({ message: 'Corte eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
