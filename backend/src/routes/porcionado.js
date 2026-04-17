const router = require('express').Router();
const { pool } = require('../models/database');

const SELECT_BASE = `
  SELECT p.*, a.numero_trazabilidad, pr.codigo as primal_codigo, pr.tipo_primal, pr.marmoleo as primal_marmoleo
  FROM porcionado p
  LEFT JOIN animales a ON p.animal_id = a.id
  LEFT JOIN primales pr ON p.primal_id = pr.id
`;

router.get('/', async (req, res) => {
  const { animal_id, primal_id } = req.query;
  let sql = SELECT_BASE + ' WHERE 1=1';
  const params = [];
  if (animal_id) { sql += ' AND p.animal_id = ?'; params.push(animal_id); }
  if (primal_id) { sql += ' AND p.primal_id = ?'; params.push(primal_id); }
  sql += ' ORDER BY p.fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(SELECT_BASE + ' WHERE p.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Porcionado no encontrado' });
    const [stickers] = await pool.query('SELECT * FROM stickers WHERE porcionado_id = ? ORDER BY id', [req.params.id]);
    res.json({ ...rows[0], stickers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { primal_id, fecha, peso_inicial, peso_final, trimming_kg, bch_kg, destino_trimming, responsable, notas } = req.body;
  if (!primal_id || !fecha || peso_inicial == null || peso_final == null) {
    return res.status(400).json({ error: 'primal_id, fecha, peso_inicial y peso_final son requeridos' });
  }
  const pi = parseFloat(peso_inicial);
  const pf = parseFloat(peso_final);
  if (pf > pi) return res.status(400).json({ error: 'peso_final no puede ser mayor que peso_inicial' });
  const bch = bch_kg != null ? parseFloat(bch_kg) : 0;
  const trim = trimming_kg != null ? parseFloat(trimming_kg) : parseFloat((pi - pf - bch).toFixed(3));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [primalRows] = await conn.query('SELECT animal_id FROM primales WHERE id = ?', [primal_id]);
    if (!primalRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Primal no encontrado' }); }
    const animal_id = primalRows[0].animal_id;
    const [result] = await conn.query(`
      INSERT INTO porcionado (primal_id, animal_id, fecha, peso_inicial, peso_final, trimming_kg, bch_kg, destino_trimming, responsable, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [primal_id, animal_id, fecha, pi, pf, trim, bch, destino_trimming || null, responsable || null, notas || null]);
    await conn.query("UPDATE primales SET estado = 'porcionado' WHERE id = ?", [primal_id]);
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE p.id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT primal_id FROM porcionado WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Porcionado no encontrado' });
    const primal_id = rows[0].primal_id;
    await pool.query('DELETE FROM porcionado WHERE id = ?', [req.params.id]);
    try { await pool.query("UPDATE primales SET estado = 'en_porcionado' WHERE id = ?", [primal_id]); } catch (e) {}
    res.json({ message: 'Porcionado eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
