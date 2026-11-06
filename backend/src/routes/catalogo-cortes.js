// Catálogo de cortes (códigos de artículo CIISA) editable desde la app.
//
//   GET    /                       lista (filtros activo, tipo, q)
//   GET    /pendientes             líneas guardadas con el código 99 «pendiente de codificar»
//   POST   /pendientes/reasignar   { origen, informado, codigo } → pasa esas líneas al código real
//   GET    /:id | /codigo/:codigo  un corte
//   GET    /:id/bitacora           quién cambió qué
//   POST   /                       alta (pantalla o alta rápida en línea: { ..., origen: 'alta_rapida' })
//   PUT    /:id                    edición
//   DELETE /:id                    desactivar (nunca se borra: los históricos lo siguen usando)
//
// Reglas: código de 5 dígitos, único; el 99 es reservado (genérico) y no se crea ni se edita aquí.
// Un código inactivo no se ofrece en lo nuevo pero sigue valiendo en lo histórico.
// Cada escritura deja bitácora y refresca el catálogo en memoria del decodificador de etiquetas.
// Permisos: montada con `protegida` (el viewer no escribe). Todo valor del request va por `?`.

const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

idsNumericos(router);

const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos } = require('../lib/sqlUpdate');
const catalogoCortes = require('../lib/catalogoCortes');
const { TIPOS_CORTE } = require('../models/produccionCatalogo');

const RE_CODIGO = /^\d{5}$/;
const ORIGENES_ALTA = ['pantalla', 'alta_rapida'];

const usuarioId = (req) => (req.user && req.user.id) || null;

async function bitacora(db, { corteId, codigo, accion, detalle, origen = 'pantalla', usuario, importacionId = null }) {
  await db.query(
    'INSERT INTO catalogo_cortes_bitacora (corte_id, codigo, accion, detalle, origen, importacion_id, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [corteId || null, codigo, accion, detalle ? JSON.stringify(detalle) : null, origen, importacionId, usuario || null]);
}

function validarCodigoNuevo(codigo) {
  const c = String(codigo == null ? '' : codigo).trim();
  if (c === catalogoCortes.CODIGO_PENDIENTE) return { error: `El código ${c} está reservado para «${catalogoCortes.NOMBRE_PENDIENTE}»` };
  if (!RE_CODIGO.test(c)) return { error: 'El código debe tener exactamente 5 dígitos (como lo imprime CIISA)' };
  return { codigo: c };
}

router.get('/', async (req, res) => {
  const { activo, tipo, q } = req.query;
  let sql = 'SELECT * FROM catalogo_cortes WHERE 1=1';
  const params = [];
  if (activo !== undefined && activo !== '') { sql += ' AND activo = ?'; params.push(Number(activo) ? 1 : 0); }
  if (tipo) { sql += ' AND tipo = ?'; params.push(String(tipo)); }
  if (q) { sql += ' AND (codigo LIKE ? OR nombre LIKE ?)'; params.push(`%${String(q).slice(0, 60)}%`, `%${String(q).slice(0, 60)}%`); }
  sql += ' ORDER BY codigo ASC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Líneas que quedaron con el 99: del reporte de producción y de solicitudes de deshuese (históricas).
// Se agrupan por lo que traía la planta (código o nombre), que es lo que se reasigna de una vez.
router.get('/pendientes', async (req, res) => {
  try {
    const [rp] = await pool.query(
      `SELECT 'reporte' AS origen, l.codigo_informado AS informado, MAX(l.descripcion) AS descripcion,
              COUNT(*) AS lineas, SUM(l.peso_kg) AS kg,
              MIN(DATE_FORMAT(r.fecha_produccion, '%Y-%m-%d')) AS desde, MAX(DATE_FORMAT(r.fecha_produccion, '%Y-%m-%d')) AS hasta
       FROM reporte_produccion_lineas l JOIN reporte_produccion r ON r.id = l.reporte_id
       WHERE l.articulo_codigo = ? GROUP BY l.codigo_informado ORDER BY l.codigo_informado`, [catalogoCortes.CODIGO_PENDIENTE]);
    const [sl] = await pool.query(
      `SELECT 'solicitud' AS origen, l.corte_informado AS informado, l.corte_informado AS descripcion,
              COUNT(*) AS lineas, NULL AS kg,
              MIN(DATE_FORMAT(s.fecha_sacrificio, '%Y-%m-%d')) AS desde, MAX(DATE_FORMAT(s.fecha_sacrificio, '%Y-%m-%d')) AS hasta
       FROM solicitud_lineas l JOIN solicitudes_deshuese s ON s.id = l.solicitud_id
       WHERE l.corte_codigo = ? GROUP BY l.corte_informado ORDER BY l.corte_informado`, [catalogoCortes.CODIGO_PENDIENTE]);
    res.json([...rp, ...sl].map((f) => ({ ...f, lineas: Number(f.lineas), kg: f.kg == null ? null : Number(f.kg) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/pendientes/reasignar', async (req, res) => {
  const { origen, informado, codigo } = req.body || {};
  if (!['reporte', 'solicitud'].includes(origen)) return res.status(400).json({ error: 'origen debe ser «reporte» o «solicitud»' });
  if (typeof informado !== 'string') return res.status(400).json({ error: 'Falta «informado» (lo que traía la planta)' });
  const v = validarCodigoNuevo(codigo);
  if (v.error) return res.status(400).json({ error: v.error });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[corte]] = await conn.query('SELECT id, codigo, nombre FROM catalogo_cortes WHERE codigo = ?', [v.codigo]);
    if (!corte) { await conn.rollback(); return res.status(404).json({ error: `El código ${v.codigo} no existe en el catálogo: créelo primero` }); }
    let r;
    if (origen === 'reporte') {
      [r] = await conn.query(
        `UPDATE reporte_produccion_lineas SET articulo_codigo = ?, codigo_informado = '' WHERE articulo_codigo = ? AND codigo_informado = ?`,
        [v.codigo, catalogoCortes.CODIGO_PENDIENTE, informado]);
    } else {
      [r] = await conn.query(
        `UPDATE solicitud_lineas SET corte_codigo = ?, corte_informado = '' WHERE corte_codigo = ? AND corte_informado = ?`,
        [v.codigo, catalogoCortes.CODIGO_PENDIENTE, informado]);
    }
    await bitacora(conn, {
      corteId: corte.id, codigo: v.codigo, accion: 'reasignado', origen: 'pendientes', usuario: usuarioId(req),
      detalle: { desde: catalogoCortes.CODIGO_PENDIENTE, informado, origen, lineas: r.affectedRows },
    });
    await conn.commit();
    res.json({ ok: true, lineas: r.affectedRows, codigo: v.codigo, nombre: corte.nombre });
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* nada abierto */ }
    // La misma línea ya tiene ese código real en el mismo reporte/canal: no se pueden fusionar solas.
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: `Algún reporte o canal ya tiene una línea con el código ${v.codigo}: corríjalo a mano antes de reasignar` });
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.get('/codigo/:codigo', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE codigo = ?', [String(req.params.codigo)]);
    if (!rows.length) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/bitacora', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.codigo, b.accion, b.detalle, b.origen, b.importacion_id, b.created_at, u.nombre AS usuario
       FROM catalogo_cortes_bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id
       WHERE b.corte_id = ? ORDER BY b.id DESC LIMIT 200`, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Corte no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nombre, abreviatura, tipo, vida_util_dias, vida_congelado_dias, activo, notas, namp, unidad } = req.body || {};
  const v = validarCodigoNuevo(req.body && req.body.codigo);
  if (v.error) return res.status(400).json({ error: v.error });
  const desc = typeof nombre === 'string' ? nombre.trim().slice(0, 200) : '';
  if (!desc) return res.status(400).json({ error: 'La descripción es obligatoria' });
  if (tipo && !TIPOS_CORTE.includes(tipo)) return res.status(400).json({ error: `Tipo inválido: ${TIPOS_CORTE.join(', ')}` });
  if (unidad && !CORTE_ENUMS.unidad.includes(unidad)) return res.status(400).json({ error: 'Unidad inválida: kg, caja o unidad' });
  const origen = ORIGENES_ALTA.includes(req.body.origen) ? req.body.origen : 'pantalla';
  try {
    const [result] = await pool.query(
      'INSERT INTO catalogo_cortes (codigo, nombre, abreviatura, tipo, unidad, vida_util_dias, vida_congelado_dias, activo, notas, namp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.codigo, desc, abreviatura || null, tipo || 'primal', unidad || 'kg', vida_util_dias || null, vida_congelado_dias || null,
        activo === undefined ? 1 : (Number(activo) ? 1 : 0), notas || null, typeof namp === 'string' && namp.trim() ? namp.trim().slice(0, 20) : null],
    );
    const [rows] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [result.insertId]);
    await bitacora(pool, { corteId: result.insertId, codigo: v.codigo, accion: 'creado', origen, usuario: usuarioId(req), detalle: { nombre: desc, tipo: rows[0].tipo, unidad: rows[0].unidad } });
    await catalogoCortes.recargar(pool);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: `El código ${v.codigo} ya existe en el catálogo` });
    res.status(500).json({ error: err.message });
  }
});

// Lista blanca: columnas reales del catálogo (incluidas las del catálogo CIISA v10).
const CORTE_EDITABLES = [
  'codigo', 'nombre', 'nombre_en', 'abreviatura', 'tipo', 'serie', 'genetica', 'codigo_equivalente', 'namp',
  'unidad', 'vida_util_dias', 'vida_congelado_dias', 'ventana_min_dias', 'ventana_max_dias',
  'nota_enlace', 'activo', 'notas',
];
const CORTE_ENUMS = {
  tipo: TIPOS_CORTE,
  serie: ['F1', 'FB', 'PVA', 'ARREO'],
  genetica: ['F1', 'FB'],
  unidad: ['kg', 'caja', 'unidad'],
};

router.put('/:id', async (req, res) => {
  try {
    const [[antes]] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [req.params.id]);
    if (!antes) return res.status(404).json({ error: 'Corte no encontrado' });
    if (antes.codigo === catalogoCortes.CODIGO_PENDIENTE) return res.status(400).json({ error: 'El código 99 es genérico y no se edita' });
    const body = { ...(req.body || {}) };
    if (body.codigo !== undefined && String(body.codigo) !== antes.codigo) {
      const v = validarCodigoNuevo(body.codigo);
      if (v.error) return res.status(400).json({ error: v.error });
      body.codigo = v.codigo;
    }
    if (body.nombre !== undefined && !String(body.nombre).trim()) return res.status(400).json({ error: 'La descripción es obligatoria' });
    const { sql, params } = construirUpdate({
      tabla: 'catalogo_cortes', id: req.params.id, body,
      permitidas: CORTE_EDITABLES, enums: CORTE_ENUMS,
    });
    await pool.query(sql, params);
    const [[despues]] = await pool.query('SELECT * FROM catalogo_cortes WHERE id = ?', [req.params.id]);
    const cambios = CORTE_EDITABLES.filter((c) => String(antes[c] ?? '') !== String(despues[c] ?? ''))
      .map((c) => ({ campo: c, antes: antes[c], despues: despues[c] }));
    if (cambios.length) {
      const soloActivo = cambios.length === 1 && cambios[0].campo === 'activo';
      await bitacora(pool, {
        corteId: despues.id, codigo: despues.codigo, usuario: usuarioId(req), detalle: { cambios },
        accion: soloActivo ? (Number(despues.activo) ? 'activado' : 'desactivado') : 'editado',
      });
      await catalogoCortes.recargar(pool);
    }
    res.json(despues);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese código ya existe en el catálogo' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [[antes]] = await pool.query('SELECT id, codigo, activo FROM catalogo_cortes WHERE id = ?', [req.params.id]);
    if (!antes) return res.status(404).json({ error: 'Corte no encontrado' });
    if (antes.codigo === catalogoCortes.CODIGO_PENDIENTE) return res.status(400).json({ error: 'El código 99 es genérico y no se desactiva' });
    await pool.query('UPDATE catalogo_cortes SET activo = 0 WHERE id = ?', [req.params.id]);
    if (Number(antes.activo)) {
      await bitacora(pool, { corteId: antes.id, codigo: antes.codigo, accion: 'desactivado', usuario: usuarioId(req) });
      await catalogoCortes.recargar(pool);
    }
    res.json({ message: 'Corte desactivado', soft: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.bitacora = bitacora;
