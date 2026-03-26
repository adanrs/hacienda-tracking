const router = require('express').Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const { animal_id, desde, hasta } = req.query;
  let sql = `SELECT p.*, a.numero_trazabilidad, a.nombre as animal_nombre FROM pesajes p JOIN animales a ON p.animal_id = a.id WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND p.animal_id = ?`; params.push(animal_id); }
  if (desde) { sql += ` AND p.fecha >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND p.fecha <= ?`; params.push(hasta); }
  sql += ` ORDER BY p.fecha DESC`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/', (req, res) => {
  const { animal_id, peso_kg, fecha, tipo, notas } = req.body;
  if (!animal_id || !peso_kg || !fecha) {
    return res.status(400).json({ error: 'animal_id, peso_kg y fecha son requeridos' });
  }

  const addPesaje = db.transaction(() => {
    const result = db.prepare('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo, notas) VALUES (?, ?, ?, ?, ?)').run(animal_id, peso_kg, fecha, tipo || 'rutinario', notas);

    // Update peso_actual on animal with the latest weigh-in by date
    const latest = db.prepare('SELECT peso_kg FROM pesajes WHERE animal_id = ? ORDER BY fecha DESC, id DESC LIMIT 1').get(animal_id);
    if (latest) {
      db.prepare('UPDATE animales SET peso_actual = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(latest.peso_kg, animal_id);
    }

    return result;
  });

  const result = addPesaje();
  res.status(201).json(db.prepare('SELECT * FROM pesajes WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/:id', (req, res) => {
  const pesaje = db.prepare('SELECT * FROM pesajes WHERE id = ?').get(req.params.id);
  if (!pesaje) return res.status(404).json({ error: 'Pesaje no encontrado' });

  const removePesaje = db.transaction(() => {
    db.prepare('DELETE FROM pesajes WHERE id = ?').run(req.params.id);

    // Recalculate peso_actual after deletion
    const latest = db.prepare('SELECT peso_kg FROM pesajes WHERE animal_id = ? ORDER BY fecha DESC, id DESC LIMIT 1').get(pesaje.animal_id);
    db.prepare('UPDATE animales SET peso_actual = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(latest ? latest.peso_kg : null, pesaje.animal_id);
  });

  removePesaje();
  res.json({ message: 'Pesaje eliminado' });
});

module.exports = router;
