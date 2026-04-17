const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  const { tipo } = req.query;
  let sql = 'SELECT * FROM bodegas WHERE 1=1';
  const params = [];
  if (tipo) { sql += ' AND tipo = ?'; params.push(tipo); }
  sql += ' ORDER BY codigo ASC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM bodegas WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Bodega no encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { codigo, nombre, tipo, temperatura_c, capacidad_kg, activa, notas } = req.body;
  if (!codigo || !nombre || !tipo) {
    return res.status(400).json({ error: 'codigo, nombre y tipo son requeridos' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO bodegas (codigo, nombre, tipo, temperatura_c, capacidad_kg, activa, notas) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [codigo, nombre, tipo, temperatura_c || null, capacidad_kg || null, activa !== undefined ? activa : 1, notas || null]
    );
    const [rows] = await pool.query('SELECT * FROM bodegas WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Codigo de bodega ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id' && k !== 'created_at');
  if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE bodegas SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM bodegas WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Bodega no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Codigo de bodega ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const [refsDes] = await pool.query('SELECT COUNT(*) as c FROM deshuese WHERE bodega_origen_id = ?', [id]);
    const [refsPri] = await pool.query('SELECT COUNT(*) as c FROM primales WHERE bodega_actual_id = ?', [id]);
    const [refsMov] = await pool.query('SELECT COUNT(*) as c FROM movimientos_bodega WHERE bodega_origen_id = ? OR bodega_destino_id = ?', [id, id]);
    const referenced = refsDes[0].c > 0 || refsPri[0].c > 0 || refsMov[0].c > 0;
    if (referenced) {
      await pool.query('UPDATE bodegas SET activa = 0 WHERE id = ?', [id]);
      return res.json({ message: 'Bodega desactivada (en uso)', soft: true });
    }
    const [result] = await pool.query('DELETE FROM bodegas WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Bodega no encontrada' });
    res.json({ message: 'Bodega eliminada' });
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({ error: 'Bodega en uso' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
