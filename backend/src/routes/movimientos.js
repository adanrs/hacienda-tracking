const router = require('express').Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const { animal_id, potrero_id } = req.query;
  let sql = `
    SELECT m.*, a.numero_trazabilidad, a.nombre as animal_nombre,
      po.nombre as origen_nombre, pd.nombre as destino_nombre
    FROM movimientos m
    JOIN animales a ON m.animal_id = a.id
    LEFT JOIN potreros po ON m.potrero_origen_id = po.id
    LEFT JOIN potreros pd ON m.potrero_destino_id = pd.id
    WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND m.animal_id = ?`; params.push(animal_id); }
  if (potrero_id) { sql += ` AND (m.potrero_origen_id = ? OR m.potrero_destino_id = ?)`; params.push(potrero_id, potrero_id); }
  sql += ` ORDER BY m.fecha DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { animal_id, potrero_origen_id, potrero_destino_id, fecha, motivo, responsable, notas } = req.body;
  if (!animal_id || !fecha) {
    return res.status(400).json({ error: 'animal_id y fecha son requeridos' });
  }

  const moveAnimal = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO movimientos (animal_id, potrero_origen_id, potrero_destino_id, fecha, motivo, responsable, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(animal_id, potrero_origen_id || null, potrero_destino_id || null, fecha, motivo, responsable, notas);

    if (potrero_destino_id) {
      db.prepare('UPDATE animales SET potrero_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(potrero_destino_id, animal_id);
    }

    return result;
  });

  const result = moveAnimal();
  res.status(201).json(db.prepare(`
    SELECT m.*, po.nombre as origen_nombre, pd.nombre as destino_nombre
    FROM movimientos m
    LEFT JOIN potreros po ON m.potrero_origen_id = po.id
    LEFT JOIN potreros pd ON m.potrero_destino_id = pd.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM movimientos WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Movimiento no encontrado' });
  res.json({ message: 'Movimiento eliminado' });
});

module.exports = router;
