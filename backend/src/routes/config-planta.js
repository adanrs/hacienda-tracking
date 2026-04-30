const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM config_planta WHERE activa = 1 LIMIT 1');
    if (!rows.length) return res.json({});
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/', async (req, res) => {
  const fields = req.body;
  const allowed = ['nombre', 'marca_comercial', 'direccion_linea1', 'direccion_linea2', 'pais', 'numero_mag', 'consecutivo_mag', 'activa'];
  const keys = Object.keys(fields).filter(k => allowed.includes(k));
  try {
    const [existing] = await pool.query('SELECT * FROM config_planta WHERE activa = 1 LIMIT 1');
    if (existing.length) {
      if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
      const sets = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => fields[k] === '' ? null : fields[k]);
      await pool.query(`UPDATE config_planta SET ${sets} WHERE id = ?`, [...values, existing[0].id]);
      const [rows] = await pool.query('SELECT * FROM config_planta WHERE id = ?', [existing[0].id]);
      return res.json(rows[0]);
    }
    // create new active row
    const cols = keys.length ? keys : ['activa'];
    const vals = keys.length ? keys.map(k => fields[k] === '' ? null : fields[k]) : [1];
    if (!keys.includes('activa')) { cols.push('activa'); vals.push(1); }
    const placeholders = cols.map(() => '?').join(', ');
    const [result] = await pool.query(
      `INSERT INTO config_planta (${cols.join(', ')}) VALUES (${placeholders})`,
      vals
    );
    const [rows] = await pool.query('SELECT * FROM config_planta WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/next-mag', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [updateResult] = await conn.query('UPDATE config_planta SET consecutivo_mag = consecutivo_mag + 1 WHERE activa = 1');
    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'No hay configuracion de planta activa' });
    }
    const [rows] = await conn.query('SELECT consecutivo_mag FROM config_planta WHERE activa = 1');
    await conn.commit();
    res.json({ consecutivo_mag: rows[0].consecutivo_mag });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

module.exports = router;
