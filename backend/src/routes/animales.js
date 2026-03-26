const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
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

  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [animals] = await pool.query(`
      SELECT a.*, p.nombre as potrero_nombre,
        m.nombre as madre_nombre, m.numero_trazabilidad as madre_trazabilidad,
        pa.nombre as padre_nombre, pa.numero_trazabilidad as padre_trazabilidad
      FROM animales a
      LEFT JOIN potreros p ON a.potrero_id = p.id
      LEFT JOIN animales m ON a.madre_id = m.id
      LEFT JOIN animales pa ON a.padre_id = pa.id
      WHERE a.id = ?
    `, [req.params.id]);

    if (!animals.length) return res.status(404).json({ error: 'Animal no encontrado' });
    const animal = animals[0];

    const [pesajes] = await pool.query('SELECT * FROM pesajes WHERE animal_id = ? ORDER BY fecha DESC', [req.params.id]);
    const [salud] = await pool.query('SELECT * FROM eventos_salud WHERE animal_id = ? ORDER BY fecha DESC', [req.params.id]);
    const [movimientos] = await pool.query(`
      SELECT m.*, po.nombre as origen_nombre, pd.nombre as destino_nombre
      FROM movimientos m
      LEFT JOIN potreros po ON m.potrero_origen_id = po.id
      LEFT JOIN potreros pd ON m.potrero_destino_id = pd.id
      WHERE m.animal_id = ? ORDER BY m.fecha DESC
    `, [req.params.id]);
    const [crias] = await pool.query(`
      SELECT id, numero_trazabilidad, nombre, sexo, fecha_nacimiento
      FROM animales WHERE madre_id = ? OR padre_id = ?
    `, [req.params.id, req.params.id]);

    animal.pesajes = pesajes;
    animal.salud = salud;
    animal.movimientos = movimientos;
    animal.crias = crias;
    res.json(animal);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, color, marca_hierro, estado, madre_id, padre_id, potrero_id, foto_url, notas } = req.body;
  if (!numero_trazabilidad || !tipo || !sexo) {
    return res.status(400).json({ error: 'numero_trazabilidad, tipo y sexo son requeridos' });
  }
  try {
    const [result] = await pool.query(`
      INSERT INTO animales (numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, color, marca_hierro, estado, madre_id, padre_id, potrero_id, foto_url, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento || null, peso_nacimiento || null, color, marca_hierro, estado || 'activo', madre_id || null, padre_id || null, potrero_id || null, foto_url, notas]);

    if (peso_nacimiento && fecha_nacimiento) {
      await pool.query('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo) VALUES (?, ?, ?, ?)', [result.insertId, peso_nacimiento, fecha_nacimiento, 'nacimiento']);
    }
    const [rows] = await pool.query('SELECT * FROM animales WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Numero de trazabilidad ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const fields = req.body;
  const keys = Object.keys(fields).filter(k => k !== 'id');
  if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    await pool.query(`UPDATE animales SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT * FROM animales WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM animales WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Animal no encontrado' });
    res.json({ message: 'Animal eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
