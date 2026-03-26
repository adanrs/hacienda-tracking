const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { animal_id, potrero_id } = req.query;
  let sql = `
    SELECT m.*, a.numero_trazabilidad, a.nombre as animal_nombre,
      po.nombre as origen_nombre, pd.nombre as destino_nombre
    FROM movimientos m
    JOIN animales a ON m.animal_id = a.id
    LEFT JOIN potreros po ON m.potrero_origen_id = po.id
    LEFT JOIN potreros pd ON m.potrero_destino_id = pd.id
    WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND m.animal_id = ?`; params.push(animal_id); }
  if (potrero_id) { sql += ` AND (m.potrero_origen_id = ? OR m.potrero_destino_id = ?)`; params.push(potrero_id, potrero_id); }
  sql += ` ORDER BY m.fecha DESC`;
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { animal_id, potrero_origen_id, potrero_destino_id, fecha, motivo, responsable, notas } = req.body;
  if (!animal_id || !fecha) return res.status(400).json({ error: 'animal_id y fecha son requeridos' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`
      INSERT INTO movimientos (animal_id, potrero_origen_id, potrero_destino_id, fecha, motivo, responsable, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [animal_id, potrero_origen_id || null, potrero_destino_id || null, fecha, motivo, responsable, notas]);

    if (potrero_destino_id) {
      await conn.query('UPDATE animales SET potrero_id = ? WHERE id = ?', [potrero_destino_id, animal_id]);
    }
    await conn.commit();

    const [rows] = await pool.query(`
      SELECT m.*, po.nombre as origen_nombre, pd.nombre as destino_nombre
      FROM movimientos m LEFT JOIN potreros po ON m.potrero_origen_id = po.id LEFT JOIN potreros pd ON m.potrero_destino_id = pd.id
      WHERE m.id = ?
    `, [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM movimientos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.json({ message: 'Movimiento eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
