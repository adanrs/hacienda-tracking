const router = require('express').Router();
const db = require('../models/database');

// GET all animals with filters
router.get('/', (req, res) => {
  const { estado, tipo, sexo, potrero_id, search } = req.query;
  let sql = `SELECT a.*, p.nombre as potrero_nombre FROM animales a LEFT JOIN potreros p ON a.potrero_id = p.id WHERE 1=1`;
  const params = [];

  if (estado) { sql += ` AND a.estado = ?`; params.push(estado); }
  if (tipo) { sql += ` AND a.tipo = ?`; params.push(tipo); }
  if (sexo) { sql += ` AND a.sexo = ?`; params.push(sexo); }
  if (potrero_id) { sql += ` AND a.potrero_id = ?`; params.push(potrero_id); }
  if (search) {
    sql += ` AND (a.numero_trazabilidad LIKE ? OR a.nombre LIKE ? OR a.raza LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  sql += ` ORDER BY a.created_at DESC`;
  const animales = db.prepare(sql).all(...params);
  res.json(animales);
});

// GET single animal with full history
router.get('/:id', (req, res) => {
  const animal = db.prepare(`
    SELECT a.*, p.nombre as potrero_nombre,
      m.nombre as madre_nombre, m.numero_trazabilidad as madre_trazabilidad,
      pa.nombre as padre_nombre, pa.numero_trazabilidad as padre_trazabilidad
    FROM animales a
    LEFT JOIN potreros p ON a.potrero_id = p.id
    LEFT JOIN animales m ON a.madre_id = m.id
    LEFT JOIN animales pa ON a.padre_id = pa.id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!animal) return res.status(404).json({ error: 'Animal no encontrado' });

  animal.pesajes = db.prepare('SELECT * FROM pesajes WHERE animal_id = ? ORDER BY fecha DESC').all(req.params.id);
  animal.salud = db.prepare('SELECT * FROM eventos_salud WHERE animal_id = ? ORDER BY fecha DESC').all(req.params.id);
  animal.movimientos = db.prepare(`
    SELECT m.*, po.nombre as origen_nombre, pd.nombre as destino_nombre
    FROM movimientos m
    LEFT JOIN potreros po ON m.potrero_origen_id = po.id
    LEFT JOIN potreros pd ON m.potrero_destino_id = pd.id
    WHERE m.animal_id = ? ORDER BY m.fecha DESC
  `).all(req.params.id);
  animal.crias = db.prepare(`
    SELECT a.id, a.numero_trazabilidad, a.nombre, a.sexo, a.fecha_nacimiento
    FROM animales a WHERE a.madre_id = ? OR a.padre_id = ?
  `).all(req.params.id, req.params.id);

  res.json(animal);
});

// POST create animal
router.post('/', (req, res) => {
  const { numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, color, marca_hierro, estado, madre_id, padre_id, potrero_id, foto_url, notas } = req.body;

  if (!numero_trazabilidad || !tipo || !sexo) {
    return res.status(400).json({ error: 'numero_trazabilidad, tipo y sexo son requeridos' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO animales (numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, color, marca_hierro, estado, madre_id, padre_id, potrero_id, foto_url, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, color, marca_hierro, estado || 'activo', madre_id || null, padre_id || null, potrero_id || null, foto_url, notas);

    if (peso_nacimiento && fecha_nacimiento) {
      db.prepare('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo) VALUES (?, ?, ?, ?)').run(result.lastInsertRowid, peso_nacimiento, fecha_nacimiento, 'nacimiento');
    }

    const animal = db.prepare('SELECT * FROM animales WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(animal);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Numero de trazabilidad ya existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT update animal
router.put('/:id', (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id');
  if (keys.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);

  try {
    db.prepare(`UPDATE animales SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, req.params.id);
    const animal = db.prepare('SELECT * FROM animales WHERE id = ?').get(req.params.id);
    res.json(animal);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE animal
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM animales WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Animal no encontrado' });
  res.json({ message: 'Animal eliminado' });
});

module.exports = router;
