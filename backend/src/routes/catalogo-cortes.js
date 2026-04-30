const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { activo, tipo } = req.query;
  let sql = 'SELECT * FROM catalogo_cortes WHERE 1=1';
  const params = [];
  if (activo !== undefined) { sql += ' AND activo = ?'; params.push(activo); }
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY codigo ASC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/codigo/:codigo', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE codigo = ?', [req.params.codigo]);
    if (!rows.length) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { codigo, nombre, abreviatura, tipo, vida_util_dias, vida_congelado_dias, activo, notas } = req.body;
  if (!codigo || !nombre) {
    return res.status(400).json({ error: 'codigo y nombre son requeridos' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO catalogo_cortes (codigo, nombre, abreviatura, tipo, vida_util_dias, vida_congelado_dias, activo, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [codigo, nombre, abreviatura || null, tipo || null, vida_util_dias || null, vida_congelado_dias || null, activo !== undefined ? activo : 1, notas || null]
    );
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Codigo de corte ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at' && k !== 'updated_at');
  if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE catalogo_cortes SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Codigo de corte ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE catalogo_cortes SET activo = 0 WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json({ message: 'Corte desactivado', soft: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
