const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

// Todo :id de este router debe ser numérico (ver lib/params.js).
idsNumericos(router);

const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos } = require('../lib/sqlUpdate');
const { numeroDiario } = require('../lib/consecutivos');
const { errorBodegasOrdenSalida } = require('../lib/bodegasV10');

const SELECT_BASE = `
  SELECT o.*, b.codigo as bodega_codigo, b.nombre as bodega_nombre,
         bd.codigo as bodega_destino_codigo, bd.nombre as bodega_destino_nombre
  FROM ordenes_salida o
  LEFT JOIN bodegas b ON o.bodega_origen_id = b.id
  LEFT JOIN bodegas bd ON o.bodega_destino_id = bd.id
`;


async function fetchItems(id) {
  const [items] = await pool.query(`
    SELECT i.*, c.codigo as caja_codigo, pr.codigo as primal_codigo
    FROM ordenes_salida_items i
    LEFT JOIN cajas c ON i.caja_id = c.id
    LEFT JOIN primales pr ON i.primal_id = pr.id
    WHERE i.orden_id = ?
    ORDER BY i.id
  `, [id]);
  return items;
}

router.get('/', async (req, res) => {
  const { estado } = req.query;
  let sql = SELECT_BASE + ' WHERE 1=1';
  const params = [];
  if (estado) { sql += ' AND o.estado = ?'; params.push(estado); }
  sql += ' ORDER BY o.fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(SELECT_BASE + ' WHERE o.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    const items = await fetchItems(req.params.id);
    res.json({ ...rows[0], items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { fecha, solicitante, destino, bodega_origen_id, bodega_destino_id, notas, items } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha es requerida' });
  const conn = await pool.getConnection();
  try {
    const errBodegas = await errorBodegasOrdenSalida(conn, { origen: bodega_origen_id, destino: bodega_destino_id });
    if (errBodegas) return res.status(400).json({ error: errBodegas });
    await conn.beginTransaction();
    // Consecutivo atómico (lib/consecutivos.js): «cantidad del día + 1» chocaba con el UNIQUE
    // cuando dos usuarios creaban a la vez y repetía números tras borrar una orden.
    const numero = await numeroDiario(conn, { prefijo: 'OS', tabla: 'ordenes_salida' });
    const [result] = await conn.query(`
      INSERT INTO ordenes_salida (numero, fecha, solicitante, destino, bodega_origen_id, bodega_destino_id, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?)
    `, [numero, fecha, solicitante || null, destino || null, bodega_origen_id || null, bodega_destino_id || null, notas || null]);
    const orden_id = result.insertId;
    if (Array.isArray(items)) {
      for (const it of items) {
        await conn.query(`
          INSERT INTO ordenes_salida_items (orden_id, caja_id, primal_id, cantidad, peso_kg)
          VALUES (?, ?, ?, ?, ?)
        `, [orden_id, it.caja_id || null, it.primal_id || null, it.cantidad || 1, it.peso_kg || null]);
      }
    }
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE o.id = ?', [orden_id]);
    const itemRows = await fetchItems(orden_id);
    res.status(201).json({ ...rows[0], items: itemRows });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Lista blanca de la orden de salida. numero se genera al crear; items tiene su propio flujo.
// bodega_destino_id = WC-01 hace que la tienda vea la orden al despacharse (integracion-tienda.js).
const ORDEN_SALIDA_EDITABLES = ['fecha', 'solicitante', 'destino', 'bodega_origen_id', 'bodega_destino_id', 'estado', 'notas'];
// 'despachada' NO se acepta por PUT: despachar mueve cajas y stickers en POST /:id/despachar;
// marcarla a mano dejaría la orden despachada con las cajas todavía en bodega.
const ORDEN_SALIDA_ENUMS = { estado: ['pendiente', 'en_preparacion', 'cancelada'] };

router.put('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { sql, params } = construirUpdate({
      tabla: 'ordenes_salida', id: req.params.id, body: req.body,
      permitidas: ORDEN_SALIDA_EDITABLES, enums: ORDEN_SALIDA_ENUMS,
    });
    await conn.beginTransaction();
    // FOR UPDATE: la revisión de estado y el UPDATE no pueden cruzarse con un despacho en curso.
    const [actual] = await conn.query(
      'SELECT estado, bodega_origen_id, bodega_destino_id FROM ordenes_salida WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!actual.length) { await conn.rollback(); return res.status(404).json({ error: 'Orden no encontrada' }); }
    // Una orden despachada ya está en la consulta de la tienda (y sus cajas ya salieron): cambiarle
    // el estado o la bodega de destino dejaría a la tienda con un traslado que ya no existe.
    // Una cancelada tampoco se reabre.
    if (['despachada', 'cancelada'].includes(actual[0].estado)) {
      await conn.rollback();
      return res.status(409).json({ error: `La orden está ${actual[0].estado} y ya no se puede modificar` });
    }
    const origen = 'bodega_origen_id' in req.body ? req.body.bodega_origen_id : actual[0].bodega_origen_id;
    const destino = 'bodega_destino_id' in req.body ? req.body.bodega_destino_id : actual[0].bodega_destino_id;
    const errBodegas = await errorBodegasOrdenSalida(conn, { origen, destino });
    if (errBodegas) { await conn.rollback(); return res.status(400).json({ error: errBodegas }); }
    await conn.query(sql, params);
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE o.id = ?', [req.params.id]);
    const items = await fetchItems(req.params.id);
    res.json({ ...rows[0], items });
  } catch (err) {
    try { await conn.rollback(); } catch { /* sin transacción abierta */ }
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.post('/:id/despachar', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // FOR UPDATE: con doble clic o dos usuarios, el segundo espera aquí al primero y después ve la
    // orden ya despachada (409), en vez de duplicar movimientos_bodega y despachada_en.
    const [ordenRows] = await conn.query('SELECT * FROM ordenes_salida WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!ordenRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Orden no encontrada' }); }
    const orden = ordenRows[0];
    // Despachar dos veces movía otra vez las cajas y ahora además cambiaría despachada_en, con lo
    // que la tienda vería el mismo traslado como nuevo. Una cancelada tampoco se despacha.
    if (orden.estado === 'despachada' || orden.estado === 'cancelada') {
      await conn.rollback();
      return res.status(409).json({ error: `La orden ya está ${orden.estado}` });
    }

    const [items] = await conn.query('SELECT * FROM ordenes_salida_items WHERE orden_id = ?', [req.params.id]);
    const cajasIds = items.map(it => it.caja_id).filter(Boolean);
    if (cajasIds.length) {
      const [cajasIncompletas] = await conn.query(
        `SELECT codigo, estado FROM cajas WHERE id IN (${cajasIds.map(() => '?').join(',')}) AND estado NOT IN ('completa','despachada')`,
        cajasIds
      );
      if (cajasIncompletas.length) {
        await conn.rollback();
        return res.status(400).json({
          error: 'Solo se despachan cajas completas',
          cajas_incompletas: cajasIncompletas.map(c => c.codigo),
        });
      }
    }

    for (const it of items) {
      if (it.caja_id) {
        await conn.query("UPDATE cajas SET estado = 'despachada' WHERE id = ?", [it.caja_id]);
      }
      if (it.primal_id) {
        await conn.query(`
          INSERT INTO movimientos_bodega (primal_id, bodega_origen_id, bodega_destino_id, tipo, fecha, responsable, orden_salida_id)
          VALUES (?, ?, NULL, 'otro', NOW(), ?, ?)
        `, [it.primal_id, orden.bodega_origen_id, orden.solicitante, req.params.id]);
      }
    }
    // Última sentencia antes del commit: despachada_en es el cursor con que la tienda consulta los
    // despachos hacia WC-01; así queda lo más cerca posible del momento en que la orden se vuelve
    // visible (menos desfase entre transacciones; además /despachos relee 60 s hacia atrás).
    const [upd] = await conn.query(
      "UPDATE ordenes_salida SET estado = 'despachada', despachada_en = NOW(3) WHERE id = ? AND estado NOT IN ('despachada','cancelada')",
      [req.params.id]);
    if (upd.affectedRows !== 1) {
      await conn.rollback();
      return res.status(409).json({ error: 'La orden cambió de estado mientras se despachaba' });
    }
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE o.id = ?', [req.params.id]);
    const itemRows = await fetchItems(req.params.id);
    res.json({ ...rows[0], items: itemRows });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM ordenes_salida WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ message: 'Orden eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
