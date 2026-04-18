const router = require('express').Router();
const { pool } = require('../models/database');

const SELECT_BASE = `
  SELECT o.*, b.codigo as bodega_destino_codigo, b.nombre as bodega_destino_nombre
  FROM ordenes_entrada o
  LEFT JOIN bodegas b ON o.bodega_destino_id = b.id
`;

function pad(n, w) { return String(n).padStart(w, '0'); }
function ymd(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

async function fetchItems(id) {
  const [items] = await pool.query(`
    SELECT i.*, pr.codigo as primal_codigo, c.codigo as caja_codigo
    FROM ordenes_entrada_items i
    LEFT JOIN primales pr ON i.primal_id = pr.id
    LEFT JOIN cajas c ON i.caja_id = c.id
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
  const { fecha, origen, bodega_destino_id, responsable, notas, items } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha es requerida' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const today = ymd();
    const [cnt] = await conn.query('SELECT COUNT(*) as c FROM ordenes_entrada WHERE numero LIKE ?', [`OE-${today}-%`]);
    const seq = pad(cnt[0].c + 1, 3);
    const numero = `OE-${today}-${seq}`;
    const [result] = await conn.query(`
      INSERT INTO ordenes_entrada (numero, fecha, origen, bodega_destino_id, responsable, estado, notas)
      VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
    `, [numero, fecha, origen || null, bodega_destino_id || null, responsable || null, notas || null]);
    const orden_id = result.insertId;
    if (Array.isArray(items)) {
      for (const it of items) {
        await conn.query(`
          INSERT INTO ordenes_entrada_items (orden_id, primal_id, caja_id, cantidad, peso_esperado_kg)
          VALUES (?, ?, ?, ?, ?)
        `, [orden_id, it.primal_id || null, it.caja_id || null, it.cantidad || 1, it.peso_esperado_kg || null]);
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

router.post('/:id/recibir', async (req, res) => {
  const { items_recibidos = [] } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ordenRows] = await conn.query('SELECT * FROM ordenes_entrada WHERE id = ?', [req.params.id]);
    if (!ordenRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Orden no encontrada' }); }
    const orden = ordenRows[0];
    if (orden.estado === 'recibida') { await conn.rollback(); return res.status(400).json({ error: 'Orden ya recibida' }); }

    const recibidosMap = new Map(items_recibidos.map(r => [r.item_id, r]));
    const [items] = await conn.query('SELECT * FROM ordenes_entrada_items WHERE orden_id = ?', [req.params.id]);

    for (const it of items) {
      const r = recibidosMap.get(it.id);
      const peso_recibido = r?.peso_recibido_kg ?? it.peso_esperado_kg;
      await conn.query(
        'UPDATE ordenes_entrada_items SET peso_recibido_kg = ?, recibido = 1 WHERE id = ?',
        [peso_recibido, it.id]
      );
      if (it.primal_id && orden.bodega_destino_id) {
        const [p] = await conn.query('SELECT bodega_actual_id FROM primales WHERE id = ?', [it.primal_id]);
        const origen_bodega = p[0]?.bodega_actual_id || null;
        await conn.query(
          'UPDATE primales SET bodega_actual_id = ? WHERE id = ?',
          [orden.bodega_destino_id, it.primal_id]
        );
        await conn.query(`
          INSERT INTO movimientos_bodega (primal_id, bodega_origen_id, bodega_destino_id, tipo, fecha, responsable, orden_entrada_id, confirmado, notas)
          VALUES (?, ?, ?, 'recepcion_entrada', NOW(), ?, ?, 1, ?)
        `, [it.primal_id, origen_bodega, orden.bodega_destino_id, orden.responsable || null, req.params.id, `Recepcion ${orden.numero}`]);
      }
      if (it.caja_id && orden.bodega_destino_id) {
        await conn.query('UPDATE cajas SET bodega_actual_id = ? WHERE id = ?', [orden.bodega_destino_id, it.caja_id]);
      }
    }

    await conn.query("UPDATE ordenes_entrada SET estado = 'recibida', fecha_recepcion = NOW() WHERE id = ?", [req.params.id]);
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
    const [result] = await pool.query('DELETE FROM ordenes_entrada WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ message: 'Orden eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
