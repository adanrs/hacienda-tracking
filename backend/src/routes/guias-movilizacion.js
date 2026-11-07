// Guías de movilización del MAG (FTZ-02) importadas con el formato «guia-movilizacion».
//
//   GET /api/guias-movilizacion                       → lista (más reciente primero) con cuántos DIIO quedaron sin animal
//   GET /api/guias-movilizacion/:id                   → la guía con sus bovinos y el animal ligado
//   PUT /api/guias-movilizacion/:id/animales/:linea   → { arete } liga el DIIO a mano; { arete: null } lo deja sin animal
//
// Las guías se crean y se actualizan SOLO por el importador (vista previa → aplicar). Aquí solo se
// corrige el ligue de un DIIO que no calzó con ninguna I.E.: queda como vínculo 'manual' y una
// re-importación de la misma guía ya no lo cambia. No se toca la ficha del animal (su I.E.).

const router = require('express').Router();
const { idsNumericos } = require('../lib/params');
const { pool } = require('../models/database');

idsNumericos(router, ['id', 'linea']);

const errorInterno = (res, err) => { console.error('[guias-movilizacion]', err); res.status(500).json({ error: 'Error interno' }); };

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT g.id, g.numero, DATE_FORMAT(g.fecha, '%Y-%m-%d') AS fecha, g.hora, g.origen_establecimiento, g.destino_establecimiento,
              g.total_declarado, g.guia_transporte_id, gt.numero AS guia_transporte_numero,
              COUNT(l.id) AS animales, SUM(l.animal_id IS NULL) AS sin_animal
       FROM guias_movilizacion g
       LEFT JOIN guia_movilizacion_animales l ON l.guia_id = g.id
       LEFT JOIN guias_transporte gt ON gt.id = g.guia_transporte_id
       GROUP BY g.id ORDER BY g.fecha DESC, g.id DESC LIMIT 300`);
    res.json(rows.map((r) => ({ ...r, animales: Number(r.animales), sin_animal: Number(r.sin_animal || 0) })));
  } catch (err) { errorInterno(res, err); }
});

async function detalle(id) {
  const [g] = await pool.query(
    `SELECT g.*, DATE_FORMAT(g.fecha, '%Y-%m-%d') AS fecha, gt.numero AS guia_transporte_numero, u.nombre AS creado_por_nombre
     FROM guias_movilizacion g
     LEFT JOIN guias_transporte gt ON gt.id = g.guia_transporte_id
     LEFT JOIN usuarios u ON u.id = g.creado_por
     WHERE g.id = ?`, [id]);
  if (!g.length) return null;
  const [animales] = await pool.query(
    `SELECT l.id, l.orden, l.diio, l.sexo, l.raza, l.animal_id, l.vinculo, a.numero_trazabilidad AS arete,
            a.identificacion_electronica, a.sexo AS animal_sexo, a.estado AS animal_estado, u.nombre AS vinculado_por_nombre
     FROM guia_movilizacion_animales l
     LEFT JOIN animales a ON a.id = l.animal_id
     LEFT JOIN usuarios u ON u.id = l.vinculado_por
     WHERE l.guia_id = ? ORDER BY l.orden, l.id`, [id]);
  return { ...g[0], animales };
}

router.get('/:id', async (req, res) => {
  try {
    const g = await detalle(req.params.id);
    if (!g) return res.status(404).json({ error: 'Guía no encontrada' });
    res.json(g);
  } catch (err) { errorInterno(res, err); }
});

router.put('/:id/animales/:linea', async (req, res) => {
  try {
    const arete = req.body && req.body.arete != null ? String(req.body.arete).trim() : '';
    let animalId = null;
    if (arete) {
      if (arete.length > 50) return res.status(400).json({ error: 'Arete inválido' });
      const [a] = await pool.query('SELECT id FROM animales WHERE numero_trazabilidad = ?', [arete]);
      if (!a.length) return res.status(400).json({ error: `No hay ningún animal con el arete ${arete}` });
      animalId = a[0].id;
    }
    // vinculo 'manual' también al quitar el ligue: así la próxima importación no lo vuelve a poner.
    const [r] = await pool.query(
      "UPDATE guia_movilizacion_animales SET animal_id = ?, vinculo = 'manual', vinculado_por = ? WHERE id = ? AND guia_id = ?",
      [animalId, (req.user && req.user.id) || null, req.params.linea, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Esa fila no es de esta guía' });
    res.json(await detalle(req.params.id));
  } catch (err) { errorInterno(res, err); }
});

module.exports = router;
