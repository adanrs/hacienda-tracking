// Documentos de custodia de CIISA (ASE ajuste de salida / TRE traslado) importados con el formato
// «custodia-ciisa».
//
//   GET /api/documentos-custodia?tipo=&animal_id=   → lista (más reciente primero)
//   GET /api/documentos-custodia/:id                → encabezado, animal y artículos
//   PUT /api/documentos-custodia/:id/animal         → { arete } liga el documento a mano; { arete: null } lo deja sin animal
//
// Se crean y actualizan SOLO por el importador (vista previa → aplicar). Aquí solo se corrige el
// animal cuando el Lote CC / RES no alcanzó para ligarlo sin dudas (vínculo 'manual': una
// re-importación ya no lo cambia).

const router = require('express').Router();
const { idsNumericos } = require('../lib/params');
const { pool } = require('../models/database');

idsNumericos(router);

const TIPOS = ['ajuste_salida', 'traslado'];
const errorInterno = (res, err) => { console.error('[documentos-custodia]', err); res.status(500).json({ error: 'Error interno' }); };

router.get('/', async (req, res) => {
  try {
    const cond = [];
    const params = [];
    if (req.query.tipo) {
      if (!TIPOS.includes(String(req.query.tipo))) return res.status(400).json({ error: 'Tipo inválido' });
      cond.push('d.tipo = ?'); params.push(String(req.query.tipo));
    }
    if (req.query.animal_id) {
      if (!/^\d{1,10}$/.test(String(req.query.animal_id))) return res.status(400).json({ error: 'animal_id inválido' });
      cond.push('d.animal_id = ?'); params.push(Number(req.query.animal_id));
    }
    const [rows] = await pool.query(
      `SELECT d.id, d.tipo, d.numero, DATE_FORMAT(d.fecha, '%Y-%m-%d %H:%i') AS fecha, d.bodega_origen_codigo, d.bodega_origen_nombre,
              d.bodega_destino_codigo, d.bodega_destino_nombre, d.observaciones, d.lote_cc, d.res, d.animal_id, d.vinculo,
              a.numero_trazabilidad AS arete, d.total_cajas, d.total_kg, d.total_kg_declarado,
              (SELECT COUNT(*) FROM documentos_custodia_lineas x WHERE x.documento_id = d.id) AS lineas
       FROM documentos_custodia d LEFT JOIN animales a ON a.id = d.animal_id
       ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
       ORDER BY d.fecha DESC, d.id DESC LIMIT 300`, params);
    res.json(rows.map((r) => ({ ...r, lineas: Number(r.lineas) })));
  } catch (err) { errorInterno(res, err); }
});

async function detalle(id) {
  const [d] = await pool.query(
    `SELECT d.*, DATE_FORMAT(d.fecha, '%Y-%m-%d %H:%i:%s') AS fecha, a.numero_trazabilidad AS arete,
            u.nombre AS creado_por_nombre, v.nombre AS vinculado_por_nombre
     FROM documentos_custodia d
     LEFT JOIN animales a ON a.id = d.animal_id
     LEFT JOIN usuarios u ON u.id = d.creado_por
     LEFT JOIN usuarios v ON v.id = d.vinculado_por
     WHERE d.id = ?`, [id]);
  if (!d.length) return null;
  const [lineas] = await pool.query(
    `SELECT l.id, l.orden, l.codigo, l.codigo_equivalente, l.descripcion, l.unidad, l.cajas, l.kg, c.nombre AS nombre_catalogo
     FROM documentos_custodia_lineas l LEFT JOIN catalogo_cortes c ON c.codigo = l.codigo
     WHERE l.documento_id = ? ORDER BY l.orden, l.id`, [id]);
  return { ...d[0], lineas };
}

router.get('/:id', async (req, res) => {
  try {
    const d = await detalle(req.params.id);
    if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(d);
  } catch (err) { errorInterno(res, err); }
});

router.put('/:id/animal', async (req, res) => {
  try {
    const arete = req.body && req.body.arete != null ? String(req.body.arete).trim() : '';
    let animalId = null;
    if (arete) {
      if (arete.length > 50) return res.status(400).json({ error: 'Arete inválido' });
      const [a] = await pool.query('SELECT id FROM animales WHERE numero_trazabilidad = ?', [arete]);
      if (!a.length) return res.status(400).json({ error: `No hay ningún animal con el arete ${arete}` });
      animalId = a[0].id;
    }
    const [r] = await pool.query(
      "UPDATE documentos_custodia SET animal_id = ?, vinculo = 'manual', vinculado_por = ? WHERE id = ?",
      [animalId, (req.user && req.user.id) || null, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(await detalle(req.params.id));
  } catch (err) { errorInterno(res, err); }
});

module.exports = router;
