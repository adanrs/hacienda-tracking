const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

// Todo :id de este router debe ser numérico (ver lib/params.js).
idsNumericos(router);

const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos } = require('../lib/sqlUpdate');

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

// Lista blanca de cajas. num_stickers y peso_total_kg NO van: se recalculan abajo desde
// los stickers; codigo tampoco (es la identidad impresa en la etiqueta).
const CAJA_EDITABLES = ['porcionado_id', 'tipo_corte', 'estado', 'bodega_actual_id', 'fecha_empaque', 'notas'];
// Por PUT solo abierta/completa: 'despachada' la pone POST /ordenes-salida/:id/despachar y
// 'devuelta' la pone POST /devoluciones; marcarlas a mano dejaría orden/devolución sin registro.
const CAJA_ENUMS = { estado: ['abierta', 'completa'] };
// Una caja que ya salió por su flujo (despachada/devuelta) no cambia de estado por PUT.
const CAJA_ESTADOS_FINALES = ['despachada', 'devuelta'];

router.put('/:id', async (req, res) => {
  try {
    // permitirVacio: un PUT sin campos sigue sirviendo para recalcular los totales.
    const update = construirUpdate({
      tabla: 'cajas', id: req.params.id, body: req.body,
      permitidas: CAJA_EDITABLES, enums: CAJA_ENUMS, permitirVacio: true,
    });
    if (update.columnas.includes('estado')) {
      const [actual] = await pool.query('SELECT estado FROM cajas WHERE id = ?', [req.params.id]);
      if (!actual.length) return res.status(404).json({ error: 'Caja no encontrada' });
      if (CAJA_ESTADOS_FINALES.includes(actual[0].estado)) {
        return res.status(409).json({ error: `La caja está ${actual[0].estado}: su estado no se cambia por edición` });
      }
    }
    if (update.sql) await pool.query(update.sql, update.params);
    const [agg] = await pool.query(`
      SELECT COUNT(*) as c, COALESCE(SUM(peso_kg),0) as t FROM stickers WHERE caja_id = ?
    `, [req.params.id]);
    await pool.query('UPDATE cajas SET num_stickers = ?, peso_total_kg = ? WHERE id = ?', [agg[0].c, agg[0].t, req.params.id]);
    const [rows] = await pool.query(SELECT_BASE + ' WHERE c.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Caja no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
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
