const router = require('express').Router();
const { pool } = require('../models/database');
const { requireRole } = require('../middleware/auth');
const { filtrarCampos, construirUpdate, construirInsert, ErrorCampos } = require('../lib/sqlUpdate');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM config_planta WHERE activa = 1 LIMIT 1');
    if (!rows.length) return res.json({});
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PLANTA_EDITABLES = ['nombre', 'marca_comercial', 'direccion_linea1', 'direccion_linea2', 'pais', 'numero_mag', 'consecutivo_mag', 'activa'];

// Solo admin: define el número MAG y el consecutivo oficial de las etiquetas, y ninguna
// pantalla del frontend lo edita (operadores solo usan POST /next-mag).
router.put('/', requireRole('admin'), async (req, res) => {
  try {
    // Valida el body antes de cualquier consulta: una clave maliciosa no llega a la base.
    const { columnas, valores } = filtrarCampos(req.body, { permitidas: PLANTA_EDITABLES });
    const [existing] = await pool.query('SELECT * FROM config_planta WHERE activa = 1 LIMIT 1');
    if (existing.length) {
      const { sql, params } = construirUpdate({
        tabla: 'config_planta', id: existing[0].id, body: req.body, permitidas: PLANTA_EDITABLES,
      });
      await pool.query(sql, params);
      const [rows] = await pool.query('SELECT * FROM config_planta WHERE id = ?', [existing[0].id]);
      return res.json(rows[0]);
    }
    // No hay fila activa: se crea una nueva con lo recibido (siempre activa = 1).
    const i = columnas.indexOf('activa');
    if (i >= 0) { valores[i] = 1; } else { columnas.push('activa'); valores.push(1); }
    const { sql, params } = construirInsert('config_planta', columnas, valores);
    const [result] = await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM config_planta WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/next-mag', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [updateResult] = await conn.query('UPDATE config_planta SET consecutivo_mag = consecutivo_mag + 1 WHERE activa = 1');
    if (updateResult.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'No hay configuracion de planta activa' });
    }
    const [rows] = await conn.query('SELECT consecutivo_mag FROM config_planta WHERE activa = 1');
    await conn.commit();
    res.json({ consecutivo_mag: rows[0].consecutivo_mag });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

module.exports = router;
