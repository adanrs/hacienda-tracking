const router = require('express').Router();
const { pool } = require('../models/database');

const baseSelect = `
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
  const { animal_id, deshuese_id, estado, bodega_id } = req.query;
  let sql = baseSelect + ' WHERE 1=1';
  const params = [];
  if (animal_id) { sql += ' AND p.animal_id = ?'; params.push(animal_id); }
  if (deshuese_id) { sql += ' AND p.deshuese_id = ?'; params.push(deshuese_id); }
  if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
  if (bodega_id) { sql += ' AND p.bodega_actual_id = ?'; params.push(bodega_id); }
  sql += ' ORDER BY p.created_at DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(baseSelect + ' WHERE p.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Primal no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const {
    codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado,
    marmoleo, bodega_actual_id, estado, fecha_ingreso_custodia,
    fecha_maduracion_inicio, notas
  } = req.body;
  if (!codigo || !deshuese_id || !animal_id || !tipo_primal || peso_kg == null) {
    return res.status(400).json({ error: 'codigo, deshuese_id, animal_id, tipo_primal y peso_kg son requeridos' });
  }
  try {
    const [result] = await pool.query(`
      INSERT INTO primales (codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado, marmoleo, bodega_actual_id, estado, fecha_ingreso_custodia, fecha_maduracion_inicio, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado || null, marmoleo || null, bodega_actual_id || null, estado || 'en_deshuese', fecha_ingreso_custodia || null, fecha_maduracion_inicio || null, notas || null]);
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'codigo de primal duplicado' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const fields = { ...req.body };
  delete fields.id;
  delete fields.deshuese_id;
  delete fields.animal_id;
  delete fields.created_at;
  delete fields.updated_at;
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE primales SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Primal no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'codigo de primal duplicado' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM primales WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Primal no encontrado' });
    res.json({ message: 'Primal eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
