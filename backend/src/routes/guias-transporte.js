// Guías de transporte finca → planta (las crea el importador de Ganadero SG).
//
//   GET /api/guias-transporte?desde=&hasta=&estado=   → lista
//   GET /api/guias-transporte/:id                     → guía con sus animales y si ya tienen sacrificio
//   GET /api/guias-transporte/pendientes-sacrificio?fecha=  → animales enviados (hasta 7 días antes) sin sacrificio
//   PUT /api/guias-transporte/:id                     → datos del viaje (transportista, placa, guía oficial, estado, notas)
//
// Los animales de la guía no se editan aquí: vienen del reporte de Ganadero SG (re-importarlo
// actualiza la guía). Todo valor del request va por `?`.

const router = require('express').Router();
const { idsNumericos } = require('../lib/params');
const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos } = require('../lib/sqlUpdate');

idsNumericos(router);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (col, alias) => `DATE_FORMAT(${col}, '%Y-%m-%d') AS ${alias}`;

router.get('/', async (req, res) => {
  const { desde, hasta, estado } = req.query;
  const params = [];
  let sql = `SELECT g.id, g.numero, ${fmt('g.fecha_salida', 'fecha_salida')}, g.finca_origen, g.destino, g.comprador, g.tipo_destino,
      g.causa_salida, g.total_animales, g.peso_total_kg, g.estado, g.transportista, g.placa_vehiculo, g.guia_movilizacion,
      (SELECT COUNT(*) FROM guia_transporte_animales x JOIN sacrificios s ON s.animal_id = x.animal_id WHERE x.guia_id = g.id) AS sacrificados
    FROM guias_transporte g WHERE 1=1`;
  if (desde && FECHA.test(desde)) { sql += ' AND g.fecha_salida >= ?'; params.push(desde); }
  if (hasta && FECHA.test(hasta)) { sql += ' AND g.fecha_salida <= ?'; params.push(hasta); }
  if (estado) { sql += ' AND g.estado = ?'; params.push(String(estado)); }
  sql += ' ORDER BY g.fecha_salida DESC, g.id DESC LIMIT 200';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { console.error('[guias-transporte]', err); res.status(500).json({ error: 'No se pudieron cargar las guías' }); }
});

router.get('/pendientes-sacrificio', async (req, res) => {
  const fecha = FECHA.test(String(req.query.fecha || '')) ? req.query.fecha : new Date().toISOString().slice(0, 10);
  try {
    const [rows] = await pool.query(
      `SELECT x.animal_id, x.arete, x.identificacion_electronica, x.sexo, x.peso_salida_kg, g.id AS guia_id, g.numero AS guia_numero,
              ${fmt('g.fecha_salida', 'fecha_salida')}
       FROM guia_transporte_animales x
       JOIN guias_transporte g ON g.id = x.guia_id
       LEFT JOIN sacrificios s ON s.animal_id = x.animal_id
       WHERE s.id IS NULL AND g.estado <> 'anulada' AND g.fecha_salida BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ?
       ORDER BY g.fecha_salida DESC, x.orden`, [fecha, fecha]);
    res.json(rows);
  } catch (err) { console.error('[guias-transporte]', err); res.status(500).json({ error: 'No se pudieron cargar los animales pendientes' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [g] = await pool.query(
      `SELECT g.*, ${fmt('g.fecha_salida', 'fecha_salida_iso')}, u.nombre AS creado_por_nombre
       FROM guias_transporte g LEFT JOIN usuarios u ON u.id = g.creado_por WHERE g.id = ?`, [req.params.id]);
    if (!g.length) return res.status(404).json({ error: 'Guía no encontrada' });
    const [animales] = await pool.query(
      `SELECT x.*, ${fmt('x.fecha_nacimiento', 'fecha_nacimiento')}, ${fmt('x.fecha_ultima_vacuna', 'fecha_ultima_vacuna')},
              s.id AS sacrificio_id, s.numero_canal, s.peso_vivo AS peso_pie_planta, s.peso_canal_caliente, s.rendimiento_canal
       FROM guia_transporte_animales x LEFT JOIN sacrificios s ON s.animal_id = x.animal_id
       WHERE x.guia_id = ? ORDER BY x.orden, x.id`, [req.params.id]);
    res.json({ ...g[0], fecha_salida: g[0].fecha_salida_iso, animales });
  } catch (err) { console.error('[guias-transporte]', err); res.status(500).json({ error: 'No se pudo cargar la guía' }); }
});

const EDITABLES = ['transportista', 'placa_vehiculo', 'guia_movilizacion', 'estado', 'notas', 'destino'];
const ENUMS = { estado: ['borrador', 'despachada', 'recibida', 'anulada'] };

router.put('/:id', async (req, res) => {
  try {
    const { sql, params } = construirUpdate({ tabla: 'guias_transporte', id: req.params.id, body: req.body, permitidas: EDITABLES, enums: ENUMS });
    await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM guias_transporte WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Guía no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    console.error('[guias-transporte]', err);
    res.status(500).json({ error: 'No se pudo guardar la guía' });
  }
});

module.exports = router;
