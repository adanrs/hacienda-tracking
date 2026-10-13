const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

// Todo :id de este router debe ser numérico (ver lib/params.js).
idsNumericos(router);

const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos } = require('../lib/sqlUpdate');

const baseSelect = `
  SELECT p.*,
    CASE
      WHEN p.fecha_maduracion_inicio IS NOT NULL AND p.estado = 'en_maduracion'
        THEN DATEDIFF(NOW(), p.fecha_maduracion_inicio)
      ELSE p.dias_maduracion
    END AS dias_maduracion_calc,
    a.numero_trazabilidad, a.nombre as animal_nombre,
    b.codigo as bodega_codigo, b.nombre as bodega_nombre, b.tipo as bodega_tipo
  FROM primales p
  JOIN animales a ON p.animal_id = a.id
  LEFT JOIN bodegas b ON p.bodega_actual_id = b.id
`;

router.get('/', async (req, res) => {
  const { animal_id, deshuese_id, estado, bodega_id } = req.query;
  let sql = baseSelect + ' WHERE 1=1';
  const params = [];
  if (animal_id) { sql += ' AND p.animal_id = ?'; params.push(animal_id); }
  if (deshuese_id) { sql += ' AND p.deshuese_id = ?'; params.push(deshuese_id); }
  if (estado) { sql += ' AND p.estado = ?'; params.push(estado); }
  if (bodega_id) { sql += ' AND p.bodega_actual_id = ?'; params.push(bodega_id); }
  sql += ' ORDER BY p.created_at DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(baseSelect + ' WHERE p.id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Primal no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const {
    codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado,
    marmoleo, bodega_actual_id, estado, fecha_ingreso_custodia,
    fecha_maduracion_inicio, notas, ubicacion_bodega, dias_maduracion_target,
    nota_supervisor, congelado, fecha_congelado
  } = req.body;
  if (!codigo || !deshuese_id || !animal_id || !tipo_primal || peso_kg == null) {
    return res.status(400).json({ error: 'codigo, deshuese_id, animal_id, tipo_primal y peso_kg son requeridos' });
  }
  try {
    // Agregar un primal a un deshuese cerrado cambia sus pesos y rendimiento: solo admin.
    const [deshuese] = await pool.query('SELECT estado FROM deshuese WHERE id = ?', [deshuese_id]);
    if (!deshuese.length) return res.status(400).json({ error: 'El deshuese indicado no existe' });
    if (deshuese[0].estado === 'cerrado' && !esAdmin(req)) {
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede agregarle primales' });
    }
    const [result] = await pool.query(`
      INSERT INTO primales (codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado, marmoleo, bodega_actual_id, estado, fecha_ingreso_custodia, fecha_maduracion_inicio, notas, ubicacion_bodega, dias_maduracion_target, nota_supervisor, congelado, fecha_congelado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado || null, marmoleo || null, bodega_actual_id || null, estado || 'en_deshuese', fecha_ingreso_custodia || null, fecha_maduracion_inicio || null, notas || null, ubicacion_bodega || null, dias_maduracion_target != null ? dias_maduracion_target : 30, nota_supervisor || null, congelado ? 1 : 0, fecha_congelado || null]);
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'codigo de primal duplicado' });
    res.status(500).json({ error: err.message });
  }
});

// Lista blanca del primal. Fuera quedan codigo (identidad impresa en la etiqueta),
// deshuese_id/animal_id (trazabilidad) y las columnas de auditoría.
const PRIMAL_EDITABLES = [
  'tipo_primal', 'peso_kg', 'peso_prorrateado', 'marmoleo', 'bodega_actual_id', 'ubicacion_bodega',
  'estado', 'congelado', 'fecha_congelado', 'fecha_ingreso_custodia', 'fecha_maduracion_inicio',
  'dias_maduracion', 'dias_maduracion_target', 'notas', 'nota_supervisor',
];
const PRIMAL_ENUMS = {
  estado: ['en_deshuese', 'en_custodia', 'en_maduracion', 'en_porcionado', 'porcionado', 'descartado'],
};
// Lo que fija el deshuese. Con el deshuese cerrado solo admin lo cambia, igual que en
// PUT /deshuese/:id/primales; si no, este endpoint saltaba ese candado.
const PRIMAL_CAMPOS_DEL_DESHUESE = ['tipo_primal', 'peso_kg', 'peso_prorrateado', 'marmoleo'];

const esAdmin = (req) => !!(req.user && req.user.rol === 'admin');

router.put('/:id', async (req, res) => {
  try {
    const update = construirUpdate({
      tabla: 'primales', id: req.params.id, body: req.body,
      permitidas: PRIMAL_EDITABLES, enums: PRIMAL_ENUMS,
    });
    const [actual] = await pool.query(
      'SELECT d.estado AS deshuese_estado FROM primales p LEFT JOIN deshuese d ON d.id = p.deshuese_id WHERE p.id = ?',
      [req.params.id]
    );
    if (!actual.length) return res.status(404).json({ error: 'Primal no encontrado' });
    const tocaDeshuese = update.columnas.some(c => PRIMAL_CAMPOS_DEL_DESHUESE.includes(c));
    if (actual[0].deshuese_estado === 'cerrado' && !esAdmin(req) && tocaDeshuese) {
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede cambiar peso, tipo o marmoleo del primal' });
    }
    await pool.query(update.sql, update.params);
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    // Quitar un primal de un deshuese cerrado también altera lo ya cerrado: solo admin.
    const [actual] = await pool.query(
      'SELECT d.estado AS deshuese_estado FROM primales p LEFT JOIN deshuese d ON d.id = p.deshuese_id WHERE p.id = ?',
      [req.params.id]
    );
    if (!actual.length) return res.status(404).json({ error: 'Primal no encontrado' });
    if (actual[0].deshuese_estado === 'cerrado' && !esAdmin(req)) {
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede eliminar sus primales' });
    }
    const [result] = await pool.query('DELETE FROM primales WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Primal no encontrado' });
    res.json({ message: 'Primal eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Sin candado de deshuese cerrado, a propósito: congelar es parte del flujo posterior al
// deshuese (custodia/maduración) y solo toca congelado/fecha_congelado/estado, que en el PUT
// tampoco están bloqueados. El candado cubre lo que fija el deshuese: pesos, tipo, marmoleo.
router.post('/:id/congelar', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM primales WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Primal no encontrado' });
    try {
      await pool.query(`UPDATE primales SET congelado = 1, fecha_congelado = NOW(), estado = 'congelado' WHERE id = ?`, [req.params.id]);
    } catch (e) {
      if (e.code === 'WARN_DATA_TRUNCATED' || e.code === 'ER_DATA_TRUNCATED' || e.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') {
        await pool.query(`UPDATE primales SET congelado = 1, fecha_congelado = NOW() WHERE id = ?`, [req.params.id]);
      } else { throw e; }
    }
    const [rows] = await pool.query('SELECT * FROM primales WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
