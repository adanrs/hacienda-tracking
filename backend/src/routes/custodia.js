const router = require('express').Router();
const { pool } = require('../models/database');

const primalSelect = `
  SELECT p.*,
    CASE
      WHEN p.fecha_maduracion_inicio IS NOT NULL AND p.estado = 'en_maduracion'
        THEN DATEDIFF(NOW(), p.fecha_maduracion_inicio)
      ELSE p.dias_maduracion
    END AS dias_maduracion_calc,
    a.numero_trazabilidad, a.nombre as animal_nombre,
    b.codigo as bodega_codigo, b.nombre as bodega_nombre, b.tipo as bodega_tipo
  FROM primales p
  JOIN animales a ON p.animal_id = a.id
  LEFT JOIN bodegas b ON p.bodega_actual_id = b.id
`;

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      primalSelect + ` WHERE p.estado IN ('en_custodia','en_maduracion') ORDER BY p.fecha_ingreso_custodia DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/recibir', async (req, res) => {
  const { primal_id, bodega_destino_id, responsable, notas } = req.body;
  if (!primal_id || !bodega_destino_id) {
    return res.status(400).json({ error: 'primal_id y bodega_destino_id son requeridos' });
  }
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
      UPDATE primales SET estado = 'en_custodia', bodega_actual_id = ?, fecha_ingreso_custodia = NOW()
      WHERE id = ?
    `, [bodega_destino_id, primal_id]);
    await conn.query(`
      INSERT INTO movimientos_bodega (primal_id, bodega_origen_id, bodega_destino_id, tipo, fecha, responsable, confirmado, notas)
      VALUES (?, ?, ?, 'ingreso_custodia', NOW(), ?, 1, ?)
    `, [primal_id, origen || null, bodega_destino_id, responsable || null, notas || null]);
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [primal_id]);
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.post('/mover', async (req, res) => {
  const { primal_id, bodega_destino_id, tipo, responsable, notas } = req.body;
  if (!primal_id || !bodega_destino_id || !tipo) {
    return res.status(400).json({ error: 'primal_id, bodega_destino_id y tipo son requeridos' });
  }
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
      INSERT INTO movimientos_bodega (primal_id, bodega_origen_id, bodega_destino_id, tipo, fecha, responsable, confirmado, notas)
      VALUES (?, ?, ?, ?, NOW(), ?, 1, ?)
    `, [primal_id, origen || null, bodega_destino_id, tipo, responsable || null, notas || null]);

    if (tipo === 'paso_maduracion') {
      await conn.query(`
        UPDATE primales SET bodega_actual_id = ?, estado = 'en_maduracion', fecha_maduracion_inicio = NOW()
        WHERE id = ?
      `, [bodega_destino_id, primal_id]);
    } else if (tipo === 'salida_porcionado') {
      await conn.query(`
        UPDATE primales SET bodega_actual_id = ?, estado = 'en_porcionado'
        WHERE id = ?
      `, [bodega_destino_id, primal_id]);
    } else {
      await conn.query('UPDATE primales SET bodega_actual_id = ? WHERE id = ?', [bodega_destino_id, primal_id]);
    }
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [primal_id]);
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.get('/movimientos', async (req, res) => {
  const { primal_id } = req.query;
  let sql = `
    SELECT m.*,
      p.codigo as primal_codigo,
      bo.codigo as bodega_origen_codigo, bo.nombre as bodega_origen_nombre,
      bd.codigo as bodega_destino_codigo, bd.nombre as bodega_destino_nombre
    FROM movimientos_bodega m
    LEFT JOIN primales p ON m.primal_id = p.id
    LEFT JOIN bodegas bo ON m.bodega_origen_id = bo.id
    LEFT JOIN bodegas bd ON m.bodega_destino_id = bd.id
    WHERE 1=1
  `;
  const params = [];
  if (primal_id) { sql += ' AND m.primal_id = ?'; params.push(primal_id); }
  sql += ' ORDER BY m.fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
