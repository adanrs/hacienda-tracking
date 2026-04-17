const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*,
        DATEDIFF(NOW(), p.fecha_maduracion_inicio) AS dias_maduracion_calc,
        a.numero_trazabilidad, a.nombre as animal_nombre,
        b.codigo as bodega_codigo, b.nombre as bodega_nombre, b.tipo as bodega_tipo
      FROM primales p
      JOIN animales a ON p.animal_id = a.id
      LEFT JOIN bodegas b ON p.bodega_actual_id = b.id
      WHERE p.estado = 'en_maduracion'
      ORDER BY dias_maduracion_calc DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/alertas', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.id as primal_id, p.codigo, p.tipo_primal, p.fecha_maduracion_inicio,
        DATEDIFF(NOW(), p.fecha_maduracion_inicio) AS dias_maduracion,
        a.numero_trazabilidad,
        CASE
          WHEN DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 30 THEN 'vencido'
          WHEN DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 28 THEN 'urgente'
          ELSE 'proximo'
        END AS nivel
      FROM primales p
      JOIN animales a ON p.animal_id = a.id
      WHERE p.estado = 'en_maduracion'
        AND DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 21
      ORDER BY dias_maduracion DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/iniciar', async (req, res) => {
  const { primal_id } = req.body;
  if (!primal_id) return res.status(400).json({ error: 'primal_id es requerido' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT * FROM primales WHERE id = ?', [primal_id]);
    if (!existing.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'Primal no encontrado' });
    }
    const origen = existing[0].bodega_actual_id;
    await conn.query(`
      UPDATE primales SET estado = 'en_maduracion', fecha_maduracion_inicio = NOW()
      WHERE id = ?
    `, [primal_id]);
    await conn.query(`
      INSERT INTO movimientos_bodega (primal_id, bodega_origen_id, bodega_destino_id, tipo, fecha, confirmado)
      VALUES (?, ?, ?, 'paso_maduracion', NOW(), 1)
    `, [primal_id, origen || null, origen || null]);
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [primal_id]);
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.put('/:primal_id', async (req, res) => {
  const { fecha_maduracion_inicio } = req.body;
  if (fecha_maduracion_inicio === undefined) {
    return res.status(400).json({ error: 'fecha_maduracion_inicio es requerida' });
  }
  try {
    const [result] = await pool.query(
      'UPDATE primales SET fecha_maduracion_inicio = ? WHERE id = ?',
      [fecha_maduracion_inicio || null, req.params.primal_id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Primal no encontrado' });
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [req.params.primal_id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
