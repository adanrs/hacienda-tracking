const router = require('express').Router();
const { pool } = require('../models/database');

const SELECT_BASE = `
  SELECT o.*, b.codigo as bodega_codigo, b.nombre as bodega_nombre
  FROM ordenes_salida o
  LEFT JOIN bodegas b ON o.bodega_origen_id = b.id
`;

function pad(n, w) { return String(n).padStart(w, '0'); }
function ymd(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

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
  const { fecha, solicitante, destino, bodega_origen_id, notas, items } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha es requerida' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const today = ymd();
    const [cnt] = await conn.query('SELECT COUNT(*) as c FROM ordenes_salida WHERE numero LIKE ?', [`OS-${today}-%`]);
    const seq = pad(cnt[0].c + 1, 3);
    const numero = `OS-${today}-${seq}`;
    const [result] = await conn.query(`
      INSERT INTO ordenes_salida (numero, fecha, solicitante, destino, bodega_origen_id, estado, notas)
      VALUES (?, ?, ?, ?, ?, 'pendiente', ?)
    `, [numero, fecha, solicitante || null, destino || null, bodega_origen_id || null, notas || null]);
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

router.put('/:id', async (req, res) => {
  const fields = { ...req.body };
  delete fields.id;
  delete fields.numero;
  delete fields.items;
  const keys = Object.keys(fields);
  if (!keys.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
  const sets = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k] === '' ? null : fields[k]);
  try {
    const [result] = await pool.query(`UPDATE ordenes_salida SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Orden no encontrada' });
    const [rows] = await pool.query(SELECT_BASE + ' WHERE o.id = ?', [req.params.id]);
    const items = await fetchItems(req.params.id);
    res.json({ ...rows[0], items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/despachar', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ordenRows] = await conn.query('SELECT * FROM ordenes_salida WHERE id = ?', [req.params.id]);
    if (!ordenRows.length) { await conn.rollback(); return res.status(404).json({ error: 'Orden no encontrada' }); }
    const orden = ordenRows[0];

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

    await conn.query("UPDATE ordenes_salida SET estado = 'despachada' WHERE id = ?", [req.params.id]);
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
