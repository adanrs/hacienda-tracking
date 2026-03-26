const router = require('express').Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const potreros = db.prepare(`
    SELECT p.*, COUNT(a.id) as total_animales
    FROM potreros p LEFT JOIN animales a ON a.potrero_id = p.id AND a.estado = 'activo'
    GROUP BY p.id ORDER BY p.nombre
  `).all();
  res.json(potreros);
});

router.get('/:id', (req, res) => {
  const potrero = db.prepare('SELECT * FROM potreros WHERE id = ?').get(req.params.id);
  if (!potrero) return res.status(404).json({ error: 'Potrero no encontrado' });
  potrero.animales = db.prepare("SELECT id, numero_trazabilidad, nombre, raza, sexo FROM animales WHERE potrero_id = ? AND estado = 'activo'").all(req.params.id);
  res.json(potrero);
});

router.post('/', (req, res) => {
  const { nombre, superficie_ha, capacidad_animales, estado, ubicacion_gps, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const result = db.prepare('INSERT INTO potreros (nombre, superficie_ha, capacidad_animales, estado, ubicacion_gps, notas) VALUES (?, ?, ?, ?, ?, ?)')
    .run(nombre, superficie_ha, capacidad_animales, estado || 'activo', ubicacion_gps, notas);
  res.status(201).json(db.prepare('SELECT * FROM potreros WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id');
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  db.prepare(`UPDATE potreros SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, req.params.id);
  res.json(db.prepare('SELECT * FROM potreros WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM potreros WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Potrero no encontrado' });
  res.json({ message: 'Potrero eliminado' });
});

module.exports = router;
