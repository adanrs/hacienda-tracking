const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

// Todo :id de este router debe ser numérico (ver lib/params.js).
idsNumericos(router);

const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos, normalizarFechaIso } = require('../lib/sqlUpdate');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM sacrificios s JOIN animales a ON s.animal_id = a.id
      ORDER BY s.fecha DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM sacrificios s JOIN animales a ON s.animal_id = a.id
      WHERE s.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio, notas, numero_mag, lote_mag, tara_kg, cuenta, ruta, tipo_pasaje, musculo, denticion, encarnada, golpe, ph_24h, temp_24h } = req.body;
  if (!animal_id || !fecha) {
    return res.status(400).json({ error: 'animal_id y fecha son requeridos' });
  }
  const rendimiento_canal = (peso_vivo && peso_canal_frio) ? parseFloat(((peso_canal_frio / peso_vivo) * 100).toFixed(2)) : null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(`
      INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, rendimiento_canal, marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio, notas, numero_mag, lote_mag, tara_kg, cuenta, ruta, tipo_pasaje, musculo, denticion, encarnada, golpe, ph_24h, temp_24h)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [animal_id, fecha, peso_vivo || null, peso_canal_caliente || null, peso_canal_frio || null, rendimiento_canal, marmoleo || null, ojo_ribeye_cm2 || null, fecha_marmoleo || null, fecha_colgado || null, inspector, resultado_inspeccion || 'aprobado', lote_sacrificio, notas, numero_mag || null, lote_mag || null, tara_kg || null, cuenta || null, ruta || null, tipo_pasaje || null, musculo || null, denticion || null, encarnada || null, golpe || null, ph_24h || null, temp_24h || null]);
    await conn.query("UPDATE animales SET estado = 'sacrificado' WHERE id = ?", [animal_id]);
    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Este animal ya tiene un registro de sacrificio' });
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ── Selección múltiple ────────────────────────────────────────────────────
// GET /api/sacrificio/propuesta?fecha=AAAA-MM-DD → animales de las guías de transporte (o transportes
// sueltos) que salieron hasta 7 días antes de esa fecha y todavía NO tienen sacrificio. Es la lista que
// la pantalla propone para llenar la tabla editable.
router.get('/propuesta', async (req, res) => {
  const fecha = String(req.query.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha debe ser AAAA-MM-DD' });
  try {
    const [rows] = await pool.query(
      `SELECT a.id AS animal_id, a.numero_trazabilidad, a.identificacion_electronica, a.sexo, a.finca, p.nombre AS potrero_nombre,
              MAX(COALESCE(gta.peso_salida_kg, t.peso_pie_finca)) AS peso_salida_kg,
              MAX(g.numero) AS guia_numero, MAX(DATE_FORMAT(COALESCE(g.fecha_salida, t.fecha_salida), '%Y-%m-%d')) AS fecha_salida
       FROM animales a
       LEFT JOIN potreros p ON p.id = a.potrero_id
       LEFT JOIN guia_transporte_animales gta ON gta.animal_id = a.id
       LEFT JOIN guias_transporte g ON g.id = gta.guia_id AND g.estado <> 'anulada'
       LEFT JOIN transporte t ON t.animal_id = a.id AND t.estado <> 'cancelado'
       WHERE NOT EXISTS (SELECT 1 FROM sacrificios s WHERE s.animal_id = a.id)
         AND (g.fecha_salida BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ? OR DATE(t.fecha_salida) BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ?)
       GROUP BY a.id, a.numero_trazabilidad, a.identificacion_electronica, a.sexo, a.finca, p.nombre
       ORDER BY a.numero_trazabilidad
       LIMIT 500`, [fecha, fecha, fecha, fecha]);
    res.json(rows.map((r) => ({ ...r, peso_salida_kg: r.peso_salida_kg == null ? null : Number(r.peso_salida_kg) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sacrificio/lote { fecha, filas: [{ animal_id, peso_vivo, peso_canal_caliente, numero_canal,
//   musculo, denticion, grasa, golpe, condicion_corporal }] } — todo o nada, con el error por fila.
// El rendimiento se calcula con el peso canal caliente (el que pesa CIISA el día del sacrificio),
// igual que el importador del correo.
const MAX_LOTE = 300;
router.post('/lote', async (req, res) => {
  const b = req.body || {};
  const filas = Array.isArray(b.filas) ? b.filas : [];
  const fecha = String(b.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'Indique la fecha de sacrificio' });
  if (!filas.length) return res.status(400).json({ error: 'Seleccione al menos un animal' });
  if (filas.length > MAX_LOTE) return res.status(400).json({ error: `Máximo ${MAX_LOTE} animales por vez` });
  const errores = [];
  const num = (v, min, max, nombre, i, entero = false) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < min || n > max || (entero && !Number.isInteger(n))) { errores.push({ fila: i + 1, error: `${nombre} debe estar entre ${min} y ${max}` }); return null; }
    return n;
  };
  const vistos = new Set();
  const canales = new Set();
  const datos = filas.map((f, i) => {
    const id = Number(f && f.animal_id);
    if (!Number.isInteger(id) || id <= 0) errores.push({ fila: i + 1, error: 'Animal inválido' });
    else if (vistos.has(id)) errores.push({ fila: i + 1, error: 'Animal repetido' });
    vistos.add(id);
    const pie = num(f.peso_vivo, 150, 1500, 'Peso pie', i);
    const canal = num(f.peso_canal_caliente, 50, 1000, 'Peso canal', i);
    if (pie != null && canal != null && canal >= pie) errores.push({ fila: i + 1, error: 'El peso canal debe ser menor que el peso pie' });
    let nCanal = null;
    try { nCanal = normalizarNumeroCanal(f.numero_canal); } catch (e) { errores.push({ fila: i + 1, error: e.message }); }
    if (nCanal) { if (canales.has(nCanal)) errores.push({ fila: i + 1, error: `N.º de canal ${nCanal} repetido` }); canales.add(nCanal); }
    return {
      animal_id: id, peso_vivo: pie, peso_canal_caliente: canal, numero_canal: nCanal,
      rendimiento: pie && canal ? parseFloat(((canal / pie) * 100).toFixed(2)) : null,
      musculo: num(f.musculo, 0, 9, 'Músculo', i, true), denticion: num(f.denticion, 0, 8, 'Dientes', i, true),
      grasa: num(f.grasa, 0, 9, 'Grasa', i, true), golpe: f.golpe ? String(f.golpe).trim().slice(0, 100) || null : null,
      condicion_corporal: num(f.condicion_corporal, 1, 9, 'Condición corporal', i),
    };
  });
  if (errores.length) return res.status(400).json({ error: `Revise ${errores.length} fila(s)`, detalles: errores });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const d of datos) {
      await conn.query(
        `INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, rendimiento_canal, numero_canal, musculo, denticion, grasa, golpe, condicion_corporal, resultado_inspeccion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aprobado')`,
        [d.animal_id, `${fecha} 00:00:00`, d.peso_vivo, d.peso_canal_caliente, d.rendimiento, d.numero_canal, d.musculo, d.denticion, d.grasa, d.golpe, d.condicion_corporal]);
      await conn.query("UPDATE animales SET estado = 'sacrificado' WHERE id = ?", [d.animal_id]);
    }
    await conn.commit();
    res.status(201).json({ creados: datos.length });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Algún animal ya tiene sacrificio o el n.º de canal ya existe ese día: recargue la propuesta' });
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// rendimiento_canal no está en la lista: lo calcula el servidor (abajo) a partir de los pesos.
const SACRIFICIO_EDITABLES = [
  'fecha', 'peso_vivo', 'peso_canal_caliente', 'peso_canal_frio',
  'marmoleo', 'ojo_ribeye_cm2', 'fecha_marmoleo', 'fecha_colgado', 'inspector',
  'resultado_inspeccion', 'lote_sacrificio', 'notas',
  'numero_mag', 'lote_mag', 'tara_kg', 'cuenta', 'ruta',
  'tipo_pasaje', 'musculo', 'denticion', 'encarnada', 'golpe', 'ph_24h', 'temp_24h',
  'numero_canal', 'grasa', 'condicion_corporal',
];
const SACRIFICIO_ENUMS = { resultado_inspeccion: ['aprobado', 'rechazado', 'condicionado'] };
// Solo las columnas DATETIME pasan por la conversión ISO -> MySQL (antes se aplicaba a
// cualquier texto, incluidas notas que empezaran con una fecha).
const SACRIFICIO_FECHAS = new Set(['fecha', 'fecha_marmoleo', 'fecha_colgado']);
// N.º de canal CIISA: '' → NULL (la llave única fecha + número admite varios NULL pero no varios
// ''; el formulario reenvía la fila completa) y en mayúsculas, como lo guarda la solicitud de deshuese.
const normalizarNumeroCanal = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  if (s && !/^[0-9A-Z-]{1,10}$/.test(s)) throw new ErrorCampos('N.º de canal inválido: solo dígitos, letras y guion, hasta 10');
  return s || null;
};
const normalizarSacrificio = (col, v) => {
  if (SACRIFICIO_FECHAS.has(col)) return normalizarFechaIso(v);
  if (col === 'numero_canal') return normalizarNumeroCanal(v);
  return v;
};

router.put('/:id', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? { ...req.body } : req.body;
    delete body?.rendimiento_canal;
    let permitidas = SACRIFICIO_EDITABLES;

    // Recalcula rendimiento_canal si cambian los pesos que lo definen.
    if (body && (body.peso_vivo || body.peso_canal_frio)) {
      const [existing] = await pool.query('SELECT peso_vivo, peso_canal_frio FROM sacrificios WHERE id = ?', [req.params.id]);
      if (existing.length) {
        const pv = body.peso_vivo || existing[0].peso_vivo;
        const pcf = body.peso_canal_frio || existing[0].peso_canal_frio;
        if (pv && pcf) {
          body.rendimiento_canal = parseFloat(((pcf / pv) * 100).toFixed(2));
          permitidas = [...SACRIFICIO_EDITABLES, 'rendimiento_canal'];
        }
      }
    }

    const { sql, params } = construirUpdate({
      tabla: 'sacrificios', id: req.params.id, body,
      permitidas, enums: SACRIFICIO_ENUMS, normalizar: normalizarSacrificio,
    });
    await pool.query(sql, params);
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese n.º de canal ya lo tiene otro animal sacrificado el mismo día' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/marmoleo', async (req, res) => {
  const { marmoleo, ojo_ribeye_cm2, fecha_marmoleo, musculo, denticion, encarnada, golpe, ph_24h, temp_24h } = req.body;
  if (marmoleo == null) return res.status(400).json({ error: 'marmoleo es requerido' });
  try {
    const [result] = await pool.query(
      'UPDATE sacrificios SET marmoleo = ?, ojo_ribeye_cm2 = ?, fecha_marmoleo = ?, musculo = ?, denticion = ?, encarnada = ?, golpe = ?, ph_24h = ?, temp_24h = ? WHERE id = ?',
      [marmoleo, ojo_ribeye_cm2 || null, fecha_marmoleo || new Date(), musculo || null, denticion || null, encarnada || null, golpe || null, ph_24h || null, temp_24h || null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    const [rows] = await pool.query('SELECT * FROM sacrificios WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM sacrificios WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Sacrificio no encontrado' });
    res.json({ message: 'Sacrificio eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
