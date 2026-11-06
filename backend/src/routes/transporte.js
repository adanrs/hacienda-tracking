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

// ── Selección múltiple ────────────────────────────────────────────────────
// POST /api/transporte/lote  { fecha_salida, tipo, destino, transportista, placa_vehiculo,
//   guia_movilizacion, notas, filas: [{ animal_id, peso_pie_finca, condicion_corporal }] }
// Registra el transporte de varios animales de una vez (antes era uno por uno). Todo o nada: si
// una fila falla no se guarda ninguna y se devuelve qué fila y por qué.
const MAX_LOTE = 300;
const numOpcional = (v, min, max) => {
  if (v === null || v === undefined || v === '') return { valor: null };
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return { error: `debe estar entre ${min} y ${max}` };
  return { valor: n };
};

router.post('/lote', async (req, res) => {
  const b = req.body || {};
  const filas = Array.isArray(b.filas) ? b.filas : [];
  if (!b.fecha_salida || !/^\d{4}-\d{2}-\d{2}/.test(String(b.fecha_salida))) return res.status(400).json({ error: 'Indique la fecha de salida' });
  if (!filas.length) return res.status(400).json({ error: 'Seleccione al menos un animal' });
  if (filas.length > MAX_LOTE) return res.status(400).json({ error: `Máximo ${MAX_LOTE} animales por vez` });
  const tipo = ['finca', 'feria', 'matadero', 'otro'].includes(b.tipo) ? b.tipo : 'matadero';
  const errores = [];
  const vistos = new Set();
  const valores = filas.map((f, i) => {
    const id = Number(f && f.animal_id);
    if (!Number.isInteger(id) || id <= 0) errores.push({ fila: i + 1, error: 'Animal inválido' });
    else if (vistos.has(id)) errores.push({ fila: i + 1, error: 'Animal repetido' });
    vistos.add(id);
    const peso = numOpcional(f.peso_pie_finca, 50, 1500);
    if (peso.error) errores.push({ fila: i + 1, error: `Peso de salida ${peso.error} kg` });
    const cc = numOpcional(f.condicion_corporal, 1, 9);
    if (cc.error) errores.push({ fila: i + 1, error: `Condición corporal ${cc.error}` });
    return [id, tipo, b.destino || null, String(b.fecha_salida).slice(0, 19).replace('T', ' '), b.transportista || null,
      b.placa_vehiculo || null, b.guia_movilizacion || null, 'programado', b.notas || null, peso.valor,
      cc.valor == null ? null : Math.round(cc.valor)];
  });
  if (errores.length) return res.status(400).json({ error: `Revise ${errores.length} fila(s)`, detalles: errores });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const ids = valores.map((v) => v[0]);
    const [existen] = await conn.query('SELECT id FROM animales WHERE id IN (?)', [ids]);
    if (existen.length !== ids.length) { await conn.rollback(); return res.status(400).json({ error: 'Algún animal ya no existe: recargue la lista' }); }
    await conn.query(
      `INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, transportista, placa_vehiculo, guia_movilizacion, estado, notas, peso_pie_finca, condicion_corporal)
       VALUES ?`, [valores]);
    await conn.commit();
    res.status(201).json({ creados: valores.length });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
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
