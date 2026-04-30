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

function addDays(dateStr, days) {
  if (!dateStr || days == null) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + parseInt(days));
  return d.toISOString().slice(0, 10);
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
  let { caja_id, porcionado_id, animal_id, primal_id, tipo_corte, peso_kg, marmoleo, lote, fecha_empaque,
    corte_codigo, codigo_cue, codigo_box, codigo_peso, codigo_lot, codigo_barras,
    fecha_mejor_antes, fecha_congelar_hasta } = req.body;
  if (!caja_id || !porcionado_id || !animal_id || peso_kg == null) {
    return res.status(400).json({ error: 'caja_id, porcionado_id, animal_id y peso_kg son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (corte_codigo) {
      const [cortes] = await conn.query('SELECT codigo, nombre, vida_util_dias, vida_congelado_dias FROM catalogo_cortes WHERE codigo = ?', [corte_codigo]);
      if (cortes.length) {
        const c = cortes[0];
        if (!codigo_cue) codigo_cue = c.codigo;
        if (!tipo_corte) tipo_corte = c.nombre;
        if (fecha_empaque && !fecha_mejor_antes && c.vida_util_dias != null) {
          fecha_mejor_antes = addDays(fecha_empaque, c.vida_util_dias);
        }
        if (fecha_empaque && !fecha_congelar_hasta && c.vida_congelado_dias != null) {
          fecha_congelar_hasta = addDays(fecha_empaque, c.vida_congelado_dias);
        }
      }
    }

    if (!codigo_lot && porcionado_id) {
      const [lotRows] = await conn.query(`
        SELECT d.numero_lote FROM porcionado p
        JOIN primales pr ON p.primal_id = pr.id
        JOIN deshuese d ON pr.deshuese_id = d.id
        WHERE p.id = ?
      `, [porcionado_id]);
      if (lotRows.length && lotRows[0].numero_lote) codigo_lot = lotRows[0].numero_lote;
    }

    if (!tipo_corte) {
      await conn.rollback();
      return res.status(400).json({ error: 'tipo_corte es requerido (o pasa corte_codigo válido)' });
    }

    if (codigo_peso == null && peso_kg != null) codigo_peso = String(peso_kg);

    const [animalRows] = await conn.query('SELECT numero_trazabilidad FROM animales WHERE id = ?', [animal_id]);
    const arete = animalRows.length ? animalRows[0].numero_trazabilidad : 'XXX';

    let codigo = codigo_barras;
    if (!codigo) {
      if (codigo_cue || codigo_box || codigo_lot) {
        codigo = `${codigo_cue || ''}-${codigo_box || ''}-${codigo_lot || ''}`;
      } else {
        codigo = genCodigo(arete);
      }
    }

    let insertId;
    try {
      const [result] = await conn.query(`
        INSERT INTO stickers (codigo_barras, caja_id, porcionado_id, animal_id, primal_id, tipo_corte, peso_kg, marmoleo, lote, fecha_empaque, codigo_cue, codigo_box, codigo_peso, codigo_lot, corte_codigo, fecha_mejor_antes, fecha_congelar_hasta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [codigo, caja_id, porcionado_id, animal_id, primal_id || null, tipo_corte, peso_kg, marmoleo || null, lote || null, fecha_empaque || null, codigo_cue || null, codigo_box || null, codigo_peso || null, codigo_lot || null, corte_codigo || null, fecha_mejor_antes || null, fecha_congelar_hasta || null]);
      insertId = result.insertId;
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      codigo = genCodigo(arete, Math.floor(Math.random() * 1e6).toString(36).toUpperCase());
      const [result] = await conn.query(`
        INSERT INTO stickers (codigo_barras, caja_id, porcionado_id, animal_id, primal_id, tipo_corte, peso_kg, marmoleo, lote, fecha_empaque, codigo_cue, codigo_box, codigo_peso, codigo_lot, corte_codigo, fecha_mejor_antes, fecha_congelar_hasta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [codigo, caja_id, porcionado_id, animal_id, primal_id || null, tipo_corte, peso_kg, marmoleo || null, lote || null, fecha_empaque || null, codigo_cue || null, codigo_box || null, codigo_peso || null, codigo_lot || null, corte_codigo || null, fecha_mejor_antes || null, fecha_congelar_hasta || null]);
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
    const [existing] = await pool.query(
      'SELECT id FROM stickers WHERE codigo_barras = ? OR codigo_cue = ? OR codigo_box = ? OR codigo_lot = ? LIMIT 1',
      [codigo_barras, codigo_barras, codigo_barras, codigo_barras]
    );
    if (!existing.length) return res.status(404).json({ error: 'Sticker no encontrado' });
    await pool.query(
      'UPDATE stickers SET escaneado = 1, fecha_escaneo = NOW() WHERE id = ?',
      [existing[0].id]
    );
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
      WHERE s.id = ?
    `, [existing[0].id]);
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
