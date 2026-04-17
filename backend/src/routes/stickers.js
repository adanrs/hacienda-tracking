const router = require('express').Router();
const { pool } = require('../models/database');

const SELECT_BASE = `
  SELECT s.*, a.numero_trazabilidad, c.codigo as caja_codigo
  FROM stickers s
  LEFT JOIN animales a ON s.animal_id = a.id
  LEFT JOIN cajas c ON s.caja_id = c.id
`;

async function recomputeCaja(conn, caja_id) {
  const [agg] = await conn.query(`
    SELECT COUNT(*) as c, COALESCE(SUM(peso_kg),0) as t FROM stickers WHERE caja_id = ?
  `, [caja_id]);
  await conn.query('UPDATE cajas SET num_stickers = ?, peso_total_kg = ? WHERE id = ?', [agg[0].c, agg[0].t, caja_id]);
}

function genCodigo(arete, rand) {
  const base = (arete || 'XXX').toString();
  const suffix = Date.now().toString(36).toUpperCase();
  return rand ? `${base}-${suffix}-${rand}` : `${base}-${suffix}`;
}

router.get('/', async (req, res) => {
  const { caja_id, animal_id, escaneado } = req.query;
  let sql = SELECT_BASE + ' WHERE 1=1';
  const params = [];
  if (caja_id) { sql += ' AND s.caja_id = ?'; params.push(caja_id); }
  if (animal_id) { sql += ' AND s.animal_id = ?'; params.push(animal_id); }
  if (escaneado !== undefined) { sql += ' AND s.escaneado = ?'; params.push(parseInt(escaneado) ? 1 : 0); }
  sql += ' ORDER BY s.created_at DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { caja_id, porcionado_id, animal_id, primal_id, tipo_corte, peso_kg, marmoleo, lote, fecha_empaque } = req.body;
  if (!caja_id || !porcionado_id || !animal_id || !tipo_corte || peso_kg == null) {
    return res.status(400).json({ error: 'caja_id, porcionado_id, animal_id, tipo_corte y peso_kg son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [animalRows] = await conn.query('SELECT numero_trazabilidad FROM animales WHERE id = ?', [animal_id]);
    const arete = animalRows.length ? animalRows[0].numero_trazabilidad : 'XXX';
    let codigo = genCodigo(arete);
    let insertId;
    try {
      const [result] = await conn.query(`
        INSERT INTO stickers (codigo_barras, caja_id, porcionado_id, animal_id, primal_id, tipo_corte, peso_kg, marmoleo, lote, fecha_empaque)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [codigo, caja_id, porcionado_id, animal_id, primal_id || null, tipo_corte, peso_kg, marmoleo || null, lote || null, fecha_empaque || null]);
      insertId = result.insertId;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      codigo = genCodigo(arete, Math.floor(Math.random() * 1e6).toString(36).toUpperCase());
      const [result] = await conn.query(`
        INSERT INTO stickers (codigo_barras, caja_id, porcionado_id, animal_id, primal_id, tipo_corte, peso_kg, marmoleo, lote, fecha_empaque)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [codigo, caja_id, porcionado_id, animal_id, primal_id || null, tipo_corte, peso_kg, marmoleo || null, lote || null, fecha_empaque || null]);
      insertId = result.insertId;
    }
    await recomputeCaja(conn, caja_id);
    await conn.commit();
    const [rows] = await pool.query(SELECT_BASE + ' WHERE s.id = ?', [insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.post('/scan', async (req, res) => {
  const { codigo_barras } = req.body;
  if (!codigo_barras) return res.status(400).json({ error: 'codigo_barras es requerido' });
  try {
    const [existing] = await pool.query('SELECT id FROM stickers WHERE codigo_barras = ?', [codigo_barras]);
    if (!existing.length) return res.status(404).json({ error: 'Sticker no encontrado' });
    await pool.query('UPDATE stickers SET escaneado = 1, fecha_escaneo = NOW() WHERE codigo_barras = ?', [codigo_barras]);
    const [rows] = await pool.query(`
      SELECT s.*, a.numero_trazabilidad, a.nombre as animal_nombre,
        c.codigo as caja_codigo, c.estado as caja_estado,
        pr.codigo as primal_codigo, pr.tipo_primal,
        po.fecha as porcionado_fecha, po.responsable as porcionado_responsable
      FROM stickers s
      LEFT JOIN animales a ON s.animal_id = a.id
      LEFT JOIN cajas c ON s.caja_id = c.id
      LEFT JOIN primales pr ON s.primal_id = pr.id
      LEFT JOIN porcionado po ON s.porcionado_id = po.id
      WHERE s.codigo_barras = ?
    `, [codigo_barras]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT caja_id FROM stickers WHERE id = ?', [req.params.id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: 'Sticker no encontrado' }); }
    const caja_id = rows[0].caja_id;
    await conn.query('DELETE FROM stickers WHERE id = ?', [req.params.id]);
    await recomputeCaja(conn, caja_id);
    await conn.commit();
    res.json({ message: 'Sticker eliminado' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

module.exports = router;
