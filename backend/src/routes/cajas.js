const router = require('express').Router();
const { pool } = require('../models/database');

const SELECT_BASE = `
  SELECT c.*, b.codigo as bodega_codigo, b.nombre as bodega_nombre,
    (SELECT COUNT(*) FROM stickers s WHERE s.caja_id = c.id) as stickers_count
  FROM cajas c
  LEFT JOIN bodegas b ON c.bodega_actual_id = b.id
`;

function pad(n, w) { return String(n).padStart(w, '0'); }
function ymd(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

router.get('/', async (req, res) => {
  const { estado, bodega_id, porcionado_id } = req.query;
  let sql = SELECT_BASE + ' WHERE 1=1';
  const params = [];
  if (estado) { sql += ' AND c.estado = ?'; params.push(estado); }
  if (bodega_id) { sql += ' AND c.bodega_actual_id = ?'; params.push(bodega_id); }
  if (porcionado_id) { sql += ' AND c.porcionado_id = ?'; params.push(porcionado_id); }
  sql += ' ORDER BY c.created_at DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(SELECT_BASE + ' WHERE c.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Caja no encontrada' });
    const [stickers] = await pool.query('SELECT * FROM stickers WHERE caja_id = ? ORDER BY id', [req.params.id]);
    res.json({ ...rows[0], stickers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { porcionado_id, tipo_corte, bodega_actual_id, notas } = req.body;
  if (!tipo_corte) return res.status(400).json({ error: 'tipo_corte es requerido' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const today = ymd();
    const [cnt] = await conn.query(`SELECT COUNT(*) as c FROM cajas WHERE codigo LIKE ?`, [`CJ-${today}-%`]);
    const seq = pad(cnt[0].c + 1, 3);
    const codigo = `CJ-${today}-${seq}`;
    const [result] = await conn.query(`
      INSERT INTO cajas (codigo, porcionado_id, tipo_corte, peso_total_kg, num_stickers, estado, bodega_actual_id, notas)
      VALUES (?, ?, ?, 0, 0, 'abierta', ?, ?)
    `, [codigo, porcionado_id || null, tipo_corte, bodega_actual_id || null, notas || null]);
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE c.id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.put('/:id', async (req, res) => {
  const fields = { ...req.body };
  delete fields.id;
  delete fields.codigo;
  const keys = Object.keys(fields);
  try {
    if (keys.length) {
      const sets = keys.map(k => `${k} = ?`).join(', ');
      const values = keys.map(k => fields[k] === '' ? null : fields[k]);
      await pool.query(`UPDATE cajas SET ${sets} WHERE id = ?`, [...values, req.params.id]);
    }
    const [agg] = await pool.query(`
      SELECT COUNT(*) as c, COALESCE(SUM(peso_kg),0) as t FROM stickers WHERE caja_id = ?
    `, [req.params.id]);
    await pool.query('UPDATE cajas SET num_stickers = ?, peso_total_kg = ? WHERE id = ?', [agg[0].c, agg[0].t, req.params.id]);
    const [rows] = await pool.query(SELECT_BASE + ' WHERE c.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Caja no encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/cerrar', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [agg] = await conn.query(`
      SELECT COUNT(*) as c, COALESCE(SUM(peso_kg),0) as t FROM stickers WHERE caja_id = ?
    `, [req.params.id]);
    const [result] = await conn.query(`
      UPDATE cajas SET estado='completa', fecha_empaque=NOW(), num_stickers=?, peso_total_kg=? WHERE id = ?
    `, [agg[0].c, agg[0].t, req.params.id]);
    if (result.affectedRows === 0) { await conn.rollback(); return res.status(404).json({ error: 'Caja no encontrada' }); }
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE c.id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM cajas WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Caja no encontrada' });
    res.json({ message: 'Caja eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
