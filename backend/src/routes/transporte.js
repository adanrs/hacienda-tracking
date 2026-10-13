const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

// Todo :id de este router debe ser numérico (ver lib/params.js).
idsNumericos(router);

const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos } = require('../lib/sqlUpdate');

router.get('/', async (req, res) => {
  const { animal_id, estado, tipo } = req.query;
  let sql = `SELECT t.*, a.numero_trazabilidad, a.nombre as animal_nombre
    FROM transporte t JOIN animales a ON t.animal_id = a.id WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ` AND t.animal_id = ?`; params.push(animal_id); }
  if (estado) { sql += ` AND t.estado = ?`; params.push(estado); }
  if (tipo) { sql += ` AND t.tipo = ?`; params.push(tipo); }
  sql += ` ORDER BY t.fecha_salida DESC`;
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { animal_id, tipo, destino, fecha_salida, fecha_llegada, transportista, placa_vehiculo, guia_movilizacion, estado, notas, tipo_pasaje, satisface_retiro, peso_pie_finca, condicion_corporal } = req.body;
  if (!animal_id || !fecha_salida) {
    return res.status(400).json({ error: 'animal_id y fecha_salida son requeridos' });
  }
  try {
    const [result] = await pool.query(`
      INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, fecha_llegada, transportista, placa_vehiculo, guia_movilizacion, estado, notas, tipo_pasaje, satisface_retiro, peso_pie_finca, condicion_corporal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [animal_id, tipo || 'otro', destino, fecha_salida, fecha_llegada || null, transportista, placa_vehiculo, guia_movilizacion, estado || 'programado', notas, tipo_pasaje || null, satisface_retiro != null ? satisface_retiro : null, peso_pie_finca || null, condicion_corporal || null]);
    const [rows] = await pool.query('SELECT * FROM transporte WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const TRANSPORTE_EDITABLES = [
  'tipo', 'destino', 'fecha_salida', 'fecha_llegada', 'transportista', 'placa_vehiculo',
  'guia_movilizacion', 'estado', 'notas',
  'tipo_pasaje', 'satisface_retiro', 'peso_pie_finca', 'condicion_corporal',
];
const TRANSPORTE_ENUMS = {
  tipo: ['finca', 'feria', 'matadero', 'otro'],
  estado: ['programado', 'en_transito', 'recibido', 'cancelado'],
};

router.put('/:id', async (req, res) => {
  try {
    const { sql, params } = construirUpdate({
      tabla: 'transporte', id: req.params.id, body: req.body,
      permitidas: TRANSPORTE_EDITABLES, enums: TRANSPORTE_ENUMS,
    });
    await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM transporte WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Transporte no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM transporte WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Transporte no encontrado' });
    res.json({ message: 'Transporte eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
