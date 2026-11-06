// Consulta de los snapshots del inventario semanal de la planta CIISA (solo lectura).
// La carga se hace con el importador genérico: POST /api/importaciones/inventario-ciisa/{planificar,aplicar}.
//
//   GET /api/inventario-planta/cargas                       → snapshots (más reciente primero)
//   GET /api/inventario-planta/lineas?carga_id=&hoja=&tarima=&codigo=&trazabilidad=&vencidos=1&q=
//                                                           → líneas de un snapshot (por omisión el último)
//   GET /api/inventario-planta/comparacion?carga_id=        → altas / bajas contra el snapshot anterior
//
// Es la base para las solicitudes de traslado (marcar cajas y pedirlas a la planta): por eso cada
// línea expone su id estable dentro del snapshot. Todo valor del request va por `?`.

const router = require('express').Router();
const { compararBmsCaja, marmoleosDe, marmoleoDeLinea } = require('../lib/bmsCaja');
const { pool } = require('../models/database');
const { totalesDe, agrupar, diferencia } = require('../lib/importador/procesadores/inventarioCiisa');

const HOJAS = ['general', 'maduracion'];
const TRAZ = ['con_arete', 'recuperada', 'sin_trazabilidad', 'na'];
const MAX_LINEAS = 5000;

const envolver = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[inventario-planta]', err);
  res.status(500).json({ error: 'Error interno al consultar el inventario de la planta' });
});

const COLS_CARGA = `c.id, DATE_FORMAT(c.fecha_carga, '%Y-%m-%d %H:%i') AS fecha_carga, DATE_FORMAT(c.fecha_inventario, '%Y-%m-%d') AS fecha_inventario,
  c.archivo, c.resumen, c.importacion_id, u.nombre AS quien`;

/** Carga pedida (?carga_id) o la última; null si no hay ninguna. 400 si el id no es numérico. */
async function cargaPedida(req) {
  const id = req.query.carga_id;
  if (id != null && id !== '') {
    if (!/^\d{1,10}$/.test(String(id))) return { error: 'carga_id inválido' };
    const [[c]] = await pool.query(`SELECT ${COLS_CARGA} FROM inventario_planta_cargas c LEFT JOIN usuarios u ON u.id = c.quien WHERE c.id = ?`, [id]);
    return c ? { carga: c } : { error: 'Snapshot no encontrado', status: 404 };
  }
  const [[c]] = await pool.query(`SELECT ${COLS_CARGA} FROM inventario_planta_cargas c LEFT JOIN usuarios u ON u.id = c.quien ORDER BY c.id DESC LIMIT 1`);
  return { carga: c || null };
}

router.get('/cargas', envolver(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ${COLS_CARGA}, (SELECT COUNT(*) FROM inventario_planta_lineas l WHERE l.carga_id = c.id) AS lineas
     FROM inventario_planta_cargas c LEFT JOIN usuarios u ON u.id = c.quien ORDER BY c.id DESC LIMIT 60`);
  res.json(rows);
}));

router.get('/lineas', envolver(async (req, res) => {
  const r = await cargaPedida(req);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  if (!r.carga) return res.json({ carga: null, lineas: [], totales: {}, filtradas: 0, truncado: false });
  const where = ['l.carga_id = ?'];
  const params = [r.carga.id];
  const { hoja, tarima, codigo, trazabilidad, vencidos, q } = req.query;
  if (hoja) {
    if (!HOJAS.includes(String(hoja))) return res.status(400).json({ error: 'hoja inválida' });
    where.push('l.hoja = ?'); params.push(String(hoja));
  }
  if (trazabilidad) {
    if (!TRAZ.includes(String(trazabilidad))) return res.status(400).json({ error: 'trazabilidad inválida' });
    where.push('l.trazabilidad = ?'); params.push(String(trazabilidad));
  }
  if (tarima) { where.push('l.tarima = ?'); params.push(String(tarima).slice(0, 20)); }
  if (codigo) { where.push('l.codigo = ?'); params.push(String(codigo).slice(0, 10)); }
  if (vencidos === '1' || vencidos === 'true') where.push('l.vencido = 1');
  if (q) {
    const like = `%${String(q).slice(0, 60).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push('(l.descripcion LIKE ? OR l.codigo_barras LIKE ? OR l.lote LIKE ? OR l.caja LIKE ? OR l.arete LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const [lineas] = await pool.query(
    `SELECT l.id, l.hoja, l.fila, l.tarima, l.linea, l.codigo_barras, l.codigo, l.descripcion, l.caja, l.peso, l.medida, l.lote,
            DATE_FORMAT(l.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento, l.vencido, l.despacho,
            DATE_FORMAT(l.fecha_despacho, '%Y-%m-%d') AS fecha_despacho, l.pedido_por, l.orden, l.estatus,
            l.trazabilidad, l.arete, l.animal_id, l.reporte_id, l.bms
     FROM inventario_planta_lineas l WHERE ${where.join(' AND ')}
     ORDER BY l.hoja, CAST(l.tarima AS UNSIGNED), l.tarima, l.fila LIMIT ${MAX_LINEAS + 1}`, params);
  const truncado = lineas.length > MAX_LINEAS;
  if (truncado) lineas.pop();
  // BMS de cada caja contra el marmoleo medido del animal (aviso, ver lib/bmsCaja.js).
  const m = await marmoleosDe(pool, { animalIds: lineas.filter((l) => l.bms != null).map((l) => l.animal_id), aretes: lineas.filter((l) => l.bms != null).map((l) => l.arete) });
  const salida = lineas.map((l) => {
    const comp = compararBmsCaja(l.bms, marmoleoDeLinea(m, l));
    return { ...l, peso: l.peso == null ? null : Number(l.peso), vencido: Boolean(l.vencido), bms: l.bms == null ? null : Number(l.bms),
      bms_animal: comp ? comp.marmoleo_animal : null, bms_estado: comp ? comp.estado : null, bms_aviso: comp ? comp.aviso : null };
  });
  // Tarimas y códigos del snapshot completo, para los filtros de la pantalla.
  const [tarimas] = await pool.query('SELECT DISTINCT tarima FROM inventario_planta_lineas WHERE carga_id = ? AND tarima IS NOT NULL', [r.carga.id]);
  res.json({
    carga: r.carga,
    lineas: salida,
    totales: totalesDe(salida),
    filtradas: salida.length,
    truncado,
    tarimas: tarimas.map((t) => t.tarima).sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || String(a).localeCompare(String(b))),
  });
}));

router.get('/comparacion', envolver(async (req, res) => {
  const r = await cargaPedida(req);
  if (r.error) return res.status(r.status || 400).json({ error: r.error });
  if (!r.carga) return res.json({ carga: null, anterior: null, altas: [], bajas: [] });
  const [[anterior]] = await pool.query(
    `SELECT ${COLS_CARGA} FROM inventario_planta_cargas c LEFT JOIN usuarios u ON u.id = c.quien WHERE c.id < ? ORDER BY c.id DESC LIMIT 1`, [r.carga.id]);
  if (!anterior) return res.json({ carga: r.carga, anterior: null, altas: [], bajas: [] });
  const cols = 'hoja, codigo_barras, codigo, descripcion, lote, caja, tarima';
  const [act] = await pool.query(`SELECT ${cols} FROM inventario_planta_lineas WHERE carga_id = ?`, [r.carga.id]);
  const [ant] = await pool.query(`SELECT ${cols} FROM inventario_planta_lineas WHERE carga_id = ?`, [anterior.id]);
  const d = diferencia(agrupar(act), agrupar(ant));
  const orden = (a, b) => String(a.hoja).localeCompare(b.hoja) || String(a.codigo || '').localeCompare(String(b.codigo || '')) || String(a.lote || '').localeCompare(String(b.lote || ''));
  res.json({ carga: r.carga, anterior, altas: d.altas.sort(orden), bajas: d.bajas.sort(orden) });
}));

module.exports = router;
