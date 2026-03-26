const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { animal_id, desde, hasta } = req.query;
  let sql = `SELECT p.*, a.numero_trazabilidad, a.nombre as animal_nombre FROM pesajes p JOIN animales a ON p.animal_id = a.id WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND p.animal_id = ?`; params.push(animal_id); }
  if (desde) { sql += ` AND p.fecha >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND p.fecha <= ?`; params.push(hasta); }
  sql += ` ORDER BY p.fecha DESC`;
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { animal_id, peso_kg, fecha, tipo, notas } = req.body;
  if (!animal_id || !peso_kg || !fecha) {
    return res.status(400).json({ error: 'animal_id, peso_kg y fecha son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo, notas) VALUES (?, ?, ?, ?, ?)', [animal_id, peso_kg, fecha, tipo || 'rutinario', notas]);
    const [latest] = await conn.query('SELECT peso_kg FROM pesajes WHERE animal_id = ? ORDER BY fecha DESC, id DESC LIMIT 1', [animal_id]);
    if (latest.length) {
      await conn.query('UPDATE animales SET peso_actual = ? WHERE id = ?', [latest[0].peso_kg, animal_id]);
    }
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM pesajes WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [pesajes] = await conn.query('SELECT * FROM pesajes WHERE id = ?', [req.params.id]);
    if (!pesajes.length) return res.status(404).json({ error: 'Pesaje no encontrado' });
    const pesaje = pesajes[0];

    await conn.beginTransaction();
    await conn.query('DELETE FROM pesajes WHERE id = ?', [req.params.id]);
    const [latest] = await conn.query('SELECT peso_kg FROM pesajes WHERE animal_id = ? ORDER BY fecha DESC, id DESC LIMIT 1', [pesaje.animal_id]);
    await conn.query('UPDATE animales SET peso_actual = ? WHERE id = ?', [latest.length ? latest[0].peso_kg : null, pesaje.animal_id]);
    await conn.commit();
    res.json({ message: 'Pesaje eliminado' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

module.exports = router;
