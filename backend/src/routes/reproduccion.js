const router = require('express').Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const { hembra_id, resultado } = req.query;
  let sql = `
    SELECT r.*, h.numero_trazabilidad as hembra_trazabilidad, h.nombre as hembra_nombre,
      m.numero_trazabilidad as macho_trazabilidad, m.nombre as macho_nombre,
      c.numero_trazabilidad as cria_trazabilidad, c.nombre as cria_nombre
    FROM reproduccion r
    JOIN animales h ON r.hembra_id = h.id
    LEFT JOIN animales m ON r.macho_id = m.id
    LEFT JOIN animales c ON r.cria_id = c.id
    WHERE 1=1`;
  const params = [];
  if (hembra_id) { sql += ` AND r.hembra_id = ?`; params.push(hembra_id); }
  if (resultado) { sql += ` AND r.resultado = ?`; params.push(resultado); }
  sql += ` ORDER BY r.fecha_servicio DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { hembra_id, macho_id, tipo, fecha_servicio, fecha_parto_estimada, resultado, notas } = req.body;
  if (!hembra_id || !tipo || !fecha_servicio) {
    return res.status(400).json({ error: 'hembra_id, tipo y fecha_servicio son requeridos' });
  }
  const result = db.prepare(`
    INSERT INTO reproduccion (hembra_id, macho_id, tipo, fecha_servicio, fecha_parto_estimada, resultado, notas)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(hembra_id, macho_id || null, tipo, fecha_servicio, fecha_parto_estimada, resultado || 'gestante', notas);
  res.status(201).json(db.prepare('SELECT * FROM reproduccion WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id');
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  db.prepare(`UPDATE reproduccion SET ${sets} WHERE id = ?`).run(...values, req.params.id);
  res.json(db.prepare('SELECT * FROM reproduccion WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM reproduccion WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json({ message: 'Registro eliminado' });
});

module.exports = router;
