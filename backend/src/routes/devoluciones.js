const router = require('express').Router();
const { pool } = require('../models/database');

const SELECT_BASE = `
  SELECT d.*,
    c.codigo as caja_codigo,
    s.codigo_barras as sticker_codigo,
    pr.codigo as primal_codigo,
    COALESCE(a_direct.numero_trazabilidad, a_caja.numero_trazabilidad, a_primal.numero_trazabilidad) as numero_trazabilidad
  FROM devoluciones d
  LEFT JOIN cajas c ON d.caja_id = c.id
  LEFT JOIN stickers s ON d.sticker_id = s.id
  LEFT JOIN primales pr ON d.primal_id = pr.id
  LEFT JOIN animales a_direct ON s.animal_id = a_direct.id
  LEFT JOIN porcionado po ON c.porcionado_id = po.id
  LEFT JOIN animales a_caja ON po.animal_id = a_caja.id
  LEFT JOIN animales a_primal ON pr.animal_id = a_primal.id
`;

router.get('/', async (req, res) => {
  const { motivo, reprocesado } = req.query;
  let sql = SELECT_BASE + ' WHERE 1=1';
  const params = [];
  if (motivo) { sql += ' AND d.motivo = ?'; params.push(motivo); }
  if (reprocesado !== undefined) { sql += ' AND d.reprocesado = ?'; params.push(parseInt(reprocesado) ? 1 : 0); }
  sql += ' ORDER BY d.fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(SELECT_BASE + ' WHERE d.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Devolucion no encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { caja_id, sticker_id, primal_id, motivo, fecha, responsable, peso_kg, notas } = req.body;
  if (!motivo || !fecha) return res.status(400).json({ error: 'motivo y fecha son requeridos' });
  if (!caja_id && !sticker_id && !primal_id) {
    return res.status(400).json({ error: 'Se requiere al menos uno de caja_id, sticker_id o primal_id' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`
      INSERT INTO devoluciones (caja_id, sticker_id, primal_id, motivo, fecha, responsable, peso_kg, reprocesado, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `, [caja_id || null, sticker_id || null, primal_id || null, motivo, fecha, responsable || null, peso_kg || null, notas || null]);
    if (caja_id) {
      await conn.query("UPDATE cajas SET estado = 'devuelta' WHERE id = ?", [caja_id]);
    }
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE d.id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.post('/:id/reprocesar', async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE devoluciones SET reprocesado = 1, fecha_reproceso = NOW() WHERE id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Devolucion no encontrada' });
    const [rows] = await pool.query(SELECT_BASE + ' WHERE d.id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM devoluciones WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Devolucion no encontrada' });
    res.json({ message: 'Devolucion eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
