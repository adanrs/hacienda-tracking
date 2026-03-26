const router = require('express').Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const { animal_id, tipo, desde, hasta } = req.query;
  let sql = `SELECT e.*, a.numero_trazabilidad, a.nombre as animal_nombre FROM eventos_salud e JOIN animales a ON e.animal_id = a.id WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND e.animal_id = ?`; params.push(animal_id); }
  if (tipo) { sql += ` AND e.tipo = ?`; params.push(tipo); }
  if (desde) { sql += ` AND e.fecha >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND e.fecha <= ?`; params.push(hasta); }
  sql += ` ORDER BY e.fecha DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { animal_id, tipo, fecha, descripcion, producto, dosis, veterinario, costo, proxima_fecha, notas } = req.body;
  if (!animal_id || !tipo || !fecha || !descripcion) {
    return res.status(400).json({ error: 'animal_id, tipo, fecha y descripcion son requeridos' });
  }
  const result = db.prepare(`
    INSERT INTO eventos_salud (animal_id, tipo, fecha, descripcion, producto, dosis, veterinario, costo, proxima_fecha, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(animal_id, tipo, fecha, descripcion, producto, dosis, veterinario, costo || 0, proxima_fecha, notas);
  res.status(201).json(db.prepare('SELECT * FROM eventos_salud WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM eventos_salud WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json({ message: 'Evento eliminado' });
});

// GET upcoming health events (alerts)
router.get('/alertas/proximas', (req, res) => {
  const dias = req.query.dias || 30;
  const alertas = db.prepare(`
    SELECT e.*, a.numero_trazabilidad, a.nombre as animal_nombre
    FROM eventos_salud e JOIN animales a ON e.animal_id = a.id
    WHERE e.proxima_fecha IS NOT NULL AND e.proxima_fecha <= date('now', '+' || ? || ' days') AND e.proxima_fecha >= date('now')
    ORDER BY e.proxima_fecha ASC
  `).all(dias);
  res.json(alertas);
});

module.exports = router;
