const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { bodega_id, primal_id, fecha_desde, fecha_hasta } = req.query;
  let sql = `
    SELECT t.*,
      b.codigo as bodega_codigo, b.nombre as bodega_nombre,
      p.codigo as primal_codigo
    FROM temperaturas_maduracion t
    LEFT JOIN bodegas b ON t.bodega_id = b.id
    LEFT JOIN primales p ON t.primal_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (bodega_id) { sql += ' AND t.bodega_id = ?'; params.push(bodega_id); }
  if (primal_id) { sql += ' AND t.primal_id = ?'; params.push(primal_id); }
  if (fecha_desde) { sql += ' AND t.fecha >= ?'; params.push(fecha_desde); }
  if (fecha_hasta) { sql += ' AND t.fecha <= ?'; params.push(fecha_hasta); }
  sql += ' ORDER BY t.fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { bodega_id, primal_id, fecha, temperatura_c, responsable, notas } = req.body;
  if (!bodega_id || !fecha || temperatura_c == null) {
    return res.status(400).json({ error: 'bodega_id, fecha y temperatura_c son requeridos' });
  }
  const cumple = parseFloat(temperatura_c) <= 4 ? 1 : 0;
  try {
    const [result] = await pool.query(
      'INSERT INTO temperaturas_maduracion (bodega_id, primal_id, fecha, temperatura_c, responsable, cumple, notas) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [bodega_id, primal_id || null, fecha, temperatura_c, responsable || null, cumple, notas || null]
    );
    const [rows] = await pool.query('SELECT * FROM temperaturas_maduracion WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/resumen/:bodega_id', async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT
        COUNT(*) AS total,
        SUM(cumple) AS cumple_count,
        ROUND(MIN(temperatura_c), 2) AS temp_min,
        ROUND(MAX(temperatura_c), 2) AS temp_max,
        ROUND(AVG(temperatura_c), 2) AS temp_avg
      FROM temperaturas_maduracion
      WHERE bodega_id = ?
    `, [req.params.bodega_id]);
    const [last] = await pool.query(
      'SELECT * FROM temperaturas_maduracion WHERE bodega_id = ? ORDER BY fecha DESC LIMIT 1',
      [req.params.bodega_id]
    );
    const total = Number(stats[0].total) || 0;
    const cumpleCount = Number(stats[0].cumple_count) || 0;
    const porcentaje = total > 0 ? Math.round((cumpleCount / total) * 10000) / 100 : 0;
    res.json({
      total,
      cumple: cumpleCount,
      porcentaje_cumplimiento: porcentaje,
      temperatura_min: stats[0].temp_min,
      temperatura_max: stats[0].temp_max,
      temperatura_avg: stats[0].temp_avg,
      ultimo_registro: last[0] || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM temperaturas_maduracion WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ message: 'Registro eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
