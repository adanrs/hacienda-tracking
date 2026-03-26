const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, COUNT(a.id) as total_animales
      FROM potreros p LEFT JOIN animales a ON a.potrero_id = p.id AND a.estado = 'activo'
      GROUP BY p.id ORDER BY p.nombre
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [potreros] = await pool.query('SELECT * FROM potreros WHERE id = ?', [req.params.id]);
    if (!potreros.length) return res.status(404).json({ error: 'Potrero no encontrado' });
    const potrero = potreros[0];
    const [animales] = await pool.query("SELECT id, numero_trazabilidad, nombre, raza, sexo FROM animales WHERE potrero_id = ? AND estado = 'activo'", [req.params.id]);
    potrero.animales = animales;
    res.json(potrero);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nombre, superficie_ha, capacidad_animales, estado, ubicacion_gps, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const [result] = await pool.query('INSERT INTO potreros (nombre, superficie_ha, capacidad_animales, estado, ubicacion_gps, notas) VALUES (?, ?, ?, ?, ?, ?)',
      [nombre, superficie_ha, capacidad_animales, estado || 'activo', ubicacion_gps, notas]);
    const [rows] = await pool.query('SELECT * FROM potreros WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id');
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE potreros SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM potreros WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM potreros WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Potrero no encontrado' });
    res.json({ message: 'Potrero eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
