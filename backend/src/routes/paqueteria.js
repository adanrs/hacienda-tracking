const router = require('express').Router();
const { pool } = require('../models/database');

function pad(n, w) { return String(n).padStart(w, '0'); }
function ymd(d = new Date()) { return `${d.getFullYear()}${pad(d.getMonth()+1,2)}${pad(d.getDate(),2)}`; }

async function fetchFuentes(paqueteria_id) {
  const [rows] = await pool.query(`
    SELECT f.*, a.numero_trazabilidad
    FROM paqueteria_fuentes f
    LEFT JOIN animales a ON f.animal_id = a.id
    WHERE f.paqueteria_id = ?
    ORDER BY f.id
  `, [paqueteria_id]);
  return rows;
}

function computeRendimiento(peso_entrada, peso_final, aditivos) {
  const entrada = parseFloat(peso_entrada || 0) + parseFloat(aditivos || 0);
  const final = parseFloat(peso_final || 0);
  if (entrada <= 0 || final <= 0) return null;
  return parseFloat(((final / entrada) * 100).toFixed(2));
}

router.get('/', async (req, res) => {
  const { tipo_producto, estado } = req.query;
  let sql = 'SELECT * FROM productos_paqueteria WHERE 1=1';
  const params = [];
  if (tipo_producto) { sql += ' AND tipo_producto = ?'; params.push(tipo_producto); }
  if (estado) { sql += ' AND estado = ?'; params.push(estado); }
  sql += ' ORDER BY fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const fuentes = await fetchFuentes(req.params.id);
    res.json({ ...rows[0], fuentes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { tipo_producto, fecha, peso_entrada_kg, aditivos_kg, responsable, notas, fuentes = [] } = req.body;
  if (!tipo_producto || !fecha || peso_entrada_kg == null) {
    return res.status(400).json({ error: 'tipo_producto, fecha y peso_entrada_kg son requeridos' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const today = ymd();
    const prefix = {
      carne_molida: 'CM', chorizo: 'CH', tortas: 'TO', hamburguesa: 'HB', otro: 'OT',
    }[tipo_producto] || 'PQ';
    const [cnt] = await conn.query('SELECT COUNT(*) as c FROM productos_paqueteria WHERE numero_lote LIKE ?', [`${prefix}-${today}-%`]);
    const numero_lote = `${prefix}-${today}-${pad(cnt[0].c + 1, 3)}`;

    const [result] = await conn.query(`
      INSERT INTO productos_paqueteria (numero_lote, tipo_producto, fecha, peso_entrada_kg, aditivos_kg, responsable, estado, notas)
      VALUES (?, ?, ?, ?, ?, ?, 'en_proceso', ?)
    `, [numero_lote, tipo_producto, fecha, peso_entrada_kg, aditivos_kg || 0, responsable || null, notas || null]);
    const paqueteria_id = result.insertId;

    const totalFuentes = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);
    for (const f of fuentes) {
      if (!f.animal_id || !f.peso_kg) continue;
      const prop = totalFuentes > 0 ? parseFloat(((parseFloat(f.peso_kg) / totalFuentes) * 100).toFixed(2)) : null;
      await conn.query(`
        INSERT INTO paqueteria_fuentes (paqueteria_id, animal_id, origen, peso_kg, porcionado_id, deshuese_id, proporcion_pct, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [paqueteria_id, f.animal_id, f.origen || 'trim', f.peso_kg, f.porcionado_id || null, f.deshuese_id || null, prop, f.notas || null]);
    }
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [paqueteria_id]);
    const fuenteRows = await fetchFuentes(paqueteria_id);
    res.status(201).json({ ...rows[0], fuentes: fuenteRows });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.post('/:id/terminar', async (req, res) => {
  const { peso_final_kg } = req.body;
  if (peso_final_kg == null) return res.status(400).json({ error: 'peso_final_kg requerido' });
  try {
    const [existing] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const rend = computeRendimiento(existing[0].peso_entrada_kg, peso_final_kg, existing[0].aditivos_kg);
    await pool.query(
      "UPDATE productos_paqueteria SET peso_final_kg = ?, rendimiento_pct = ?, estado = 'terminado' WHERE id = ?",
      [peso_final_kg, rend, req.params.id]
    );
    const [rows] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/prorrateo', async (req, res) => {
  try {
    const [prod] = await pool.query('SELECT * FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (!prod.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const fuentes = await fetchFuentes(req.params.id);
    const pesoFinal = parseFloat(prod[0].peso_final_kg || 0);
    const totalFuentes = fuentes.reduce((s, f) => s + parseFloat(f.peso_kg || 0), 0);
    const prorrateo = fuentes.map(f => {
      const prop = totalFuentes > 0 ? parseFloat(f.peso_kg) / totalFuentes : 0;
      return {
        animal_id: f.animal_id,
        numero_trazabilidad: f.numero_trazabilidad,
        peso_origen_kg: parseFloat(f.peso_kg),
        proporcion_pct: parseFloat((prop * 100).toFixed(2)),
        peso_final_asignado_kg: parseFloat((prop * pesoFinal).toFixed(3)),
      };
    });
    res.json({ producto: prod[0], prorrateo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM productos_paqueteria WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
