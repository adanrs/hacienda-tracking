const router = require('express').Router();
const { idsNumericos } = require('../lib/params');

// Todo :id de este router debe ser numérico (ver lib/params.js).
idsNumericos(router);

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../models/database');
const { construirUpdate, ErrorCampos, normalizarFechaIso } = require('../lib/sqlUpdate');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'deshuese');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// "<id>-<timestamp>.pdf". Se rechaza cualquier id no numérico como segunda barrera por si
// alguien monta este storage en una ruta sin la validación de lib/params.js.
function nombreArchivoPdf(id) {
  if (!/^\d+$/.test(String(id))) throw new Error('id de deshuese inválido para el archivo');
  return `${id}-${Date.now()}.pdf`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  // El nombre lo genera el servidor: el nombre original del archivo lo controla el cliente y
  // podía traer separadores de ruta. req.params.id ya viene validado como solo dígitos.
  filename: (req, file, cb) => {
    try { cb(null, nombreArchivoPdf(req.params.id)); } catch (e) { cb(e); }
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Solo se permiten archivos PDF'));
    cb(null, true);
  }
});

async function generateNumeroLote(conn, sacrificio_id) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const base = `DES-${ymd}-${sacrificio_id}`;
  const [existing] = await conn.query('SELECT numero_lote FROM deshuese WHERE numero_lote LIKE ?', [`${base}%`]);
  if (!existing.length) return base;
  let n = 1;
  const taken = new Set(existing.map(r => r.numero_lote));
  if (!taken.has(base)) return base;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

router.get('/', async (req, res) => {
  const { animal_id, sacrificio_id, estado } = req.query;
  let sql = `SELECT d.*, a.numero_trazabilidad, a.nombre as animal_nombre,
    s.fecha as sacrificio_fecha, s.lote_sacrificio
    FROM deshuese d
    JOIN animales a ON d.animal_id = a.id
    LEFT JOIN sacrificios s ON d.sacrificio_id = s.id
    WHERE 1=1`;
  const params = [];
  if (animal_id) { sql += ' AND d.animal_id = ?'; params.push(animal_id); }
  if (sacrificio_id) { sql += ' AND d.sacrificio_id = ?'; params.push(sacrificio_id); }
  if (estado) { sql += ' AND d.estado = ?'; params.push(estado); }
  sql += ' ORDER BY d.fecha DESC';
  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.*, a.numero_trazabilidad, a.nombre as animal_nombre,
        s.fecha as sacrificio_fecha, s.lote_sacrificio
      FROM deshuese d
      JOIN animales a ON d.animal_id = a.id
      LEFT JOIN sacrificios s ON d.sacrificio_id = s.id
      WHERE d.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Deshuese no encontrado' });
    const [primales] = await pool.query('SELECT * FROM primales WHERE deshuese_id = ? ORDER BY id ASC', [req.params.id]);
    res.json({ ...rows[0], primales });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const {
    sacrificio_id, animal_id, fecha, peso_entrada, responsable,
    bodega_origen_id, notas, numero_lote: inputLote,
    primales = [], prorrateo
  } = req.body;

  if (!sacrificio_id || !animal_id || !fecha) {
    return res.status(400).json({ error: 'sacrificio_id, animal_id y fecha son requeridos' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const numero_lote = inputLote || await generateNumeroLote(conn, sacrificio_id);

    const [result] = await conn.query(`
      INSERT INTO deshuese (numero_lote, sacrificio_id, animal_id, fecha, peso_entrada, responsable, bodega_origen_id, notas, estado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'abierto')
    `, [numero_lote, sacrificio_id, animal_id, fecha, peso_entrada || null, responsable || null, bodega_origen_id || null, notas || null]);
    const deshuese_id = result.insertId;

    let totalPeso = 0;
    for (const p of primales) totalPeso += parseFloat(p.peso_kg || 0);

    for (let i = 0; i < primales.length; i++) {
      const p = primales[i];
      const codigo = `${numero_lote}-P${i + 1}`;
      let peso_prorrateado = null;
      if (prorrateo && peso_entrada && totalPeso > 0) {
        peso_prorrateado = parseFloat(((parseFloat(p.peso_kg) / totalPeso) * parseFloat(peso_entrada)).toFixed(3));
      }
      await conn.query(`
        INSERT INTO primales (codigo, deshuese_id, animal_id, tipo_primal, peso_kg, peso_prorrateado, marmoleo, bodega_actual_id, estado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'en_deshuese')
      `, [codigo, deshuese_id, animal_id, p.tipo_primal, p.peso_kg, peso_prorrateado, p.marmoleo || null, bodega_origen_id || null]);
    }

    await conn.commit();
    const [rows] = await pool.query('SELECT * FROM deshuese WHERE id = ?', [deshuese_id]);
    const [pris] = await pool.query('SELECT * FROM primales WHERE deshuese_id = ? ORDER BY id ASC', [deshuese_id]);
    res.status(201).json({ ...rows[0], primales: pris });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'numero_lote duplicado' });
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// Columnas que el formulario de Deshuese edita. Fuera de la lista quedan id, numero_lote
// (se genera al crear y va impreso en etiquetas), sacrificio_id/animal_id (definen la
// trazabilidad), pdf_url (tiene su propio endpoint) y las columnas de auditoría.
const DESHUESE_EDITABLES = ['fecha', 'peso_entrada', 'responsable', 'bodega_origen_id', 'notas', 'estado'];
const DESHUESE_ENUMS = { estado: ['abierto', 'cerrado', 'reabierto'] };

// El input datetime-local manda "2026-10-01T08:30" y la fila del GET trae ISO con Z;
// MySQL no acepta la "T" ni la "Z" en modo estricto.
const normalizarDeshuese = (col, v) => (col === 'fecha' ? normalizarFechaIso(v) : v);

// Candado de deshuese cerrado: solo admin puede tocar uno cerrado (reabrirlo, editarlo,
// borrarlo o cambiarle el PDF). Antes un operador podía reabrirlo mandando solo `estado`.
function bloqueadoPorCierre(req, deshuese) {
  return deshuese.estado === 'cerrado' && !(req.user && req.user.rol === 'admin');
}

router.put('/:id', async (req, res) => {
  try {
    // Se valida el body ANTES de leer la base: una clave maliciosa no llega a ningún SQL.
    const update = construirUpdate({
      tabla: 'deshuese',
      id: req.params.id,
      body: req.body,
      permitidas: DESHUESE_EDITABLES,
      enums: DESHUESE_ENUMS,
      normalizar: normalizarDeshuese,
    });

    const [existing] = await pool.query('SELECT * FROM deshuese WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Deshuese no encontrado' });
    if (bloqueadoPorCierre(req, existing[0])) {
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede modificarlo o reabrirlo' });
    }

    await pool.query(update.sql, update.params);
    const [rows] = await pool.query('SELECT * FROM deshuese WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err instanceof ErrorCampos) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT estado FROM deshuese WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Deshuese no encontrado' });
    if (bloqueadoPorCierre(req, existing[0])) {
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede eliminarlo' });
    }
    const [result] = await pool.query('DELETE FROM deshuese WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Deshuese no encontrado' });
    res.json({ message: 'Deshuese eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/primales', async (req, res) => {
  const { primales = [], reprorratear } = req.body;
  if (!Array.isArray(primales) || !primales.length) {
    return res.status(400).json({ error: 'primales (array) requerido' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [deshueseRow] = await conn.query('SELECT * FROM deshuese WHERE id = ?', [req.params.id]);
    if (!deshueseRow.length) { await conn.rollback(); return res.status(404).json({ error: 'Deshuese no encontrado' }); }
    const isAdmin = req.user && req.user.rol === 'admin';
    if (deshueseRow[0].estado === 'cerrado' && !isAdmin) {
      await conn.rollback();
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede modificar prorrateo' });
    }

    const peso_entrada = parseFloat(deshueseRow[0].peso_entrada || 0);
    let totalPeso = 0;
    for (const p of primales) totalPeso += parseFloat(p.peso_kg || 0);

    for (const p of primales) {
      if (!p.id) continue;
      let peso_prorrateado = p.peso_prorrateado != null ? parseFloat(p.peso_prorrateado) : null;
      if (reprorratear && peso_entrada > 0 && totalPeso > 0) {
        peso_prorrateado = parseFloat(((parseFloat(p.peso_kg) / totalPeso) * peso_entrada).toFixed(3));
      }
      await conn.query(`
        UPDATE primales SET peso_kg = ?, peso_prorrateado = ?, marmoleo = ?, tipo_primal = ?
        WHERE id = ? AND deshuese_id = ?
      `, [p.peso_kg, peso_prorrateado, p.marmoleo || null, p.tipo_primal, p.id, req.params.id]);
    }
    await conn.commit();
    const [pris] = await pool.query('SELECT * FROM primales WHERE deshuese_id = ? ORDER BY id ASC', [req.params.id]);
    res.json({ primales: pris });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

router.post('/:id/pdf', async (req, res, next) => {
  // El candado se revisa antes de aceptar el archivo, para no dejar PDFs huérfanos en disco.
  try {
    const [existing] = await pool.query('SELECT estado FROM deshuese WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ error: 'Deshuese no encontrado' });
    if (bloqueadoPorCierre(req, existing[0])) {
      return res.status(403).json({ error: 'Deshuese cerrado: solo admin puede cambiar el PDF' });
    }
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}, (req, res) => {
  upload.single('pdf')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
    try {
      const pdf_url = `/uploads/deshuese/${req.file.filename}`;
      await pool.query('UPDATE deshuese SET pdf_url = ? WHERE id = ?', [pdf_url, req.params.id]);
      const [rows] = await pool.query('SELECT * FROM deshuese WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Deshuese no encontrado' });
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Solo se permiten archivos PDF'));
    cb(null, true);
  }
});

function tryParsePrimales(text) {
  const TIPOS = ['LOMO','COSTILLA','PIERNA','PALETA','PECHO','FALDA','AGUJA','BCH','TRIM','RIBEYE','DELMONICO','SOLOMO','LOMITO','BOLITA','OSOBUCO','CHURRASCO','POSTA','TAPA','VUELTA','ARRACHERA','CECINA','GUITARRILLA','DIAFRAGMA','CHUCK','BRISKET'];
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    const tipo = TIPOS.find(t => upper.includes(t));
    if (!tipo) continue;
    const weights = line.match(/\d+[.,]\d+/g) || line.match(/\d{1,4}/g) || [];
    const peso = weights.length ? parseFloat(weights[weights.length - 1].replace(',', '.')) : null;
    if (peso == null || isNaN(peso) || peso <= 0 || peso > 1000) continue;
    rows.push({ tipo_primal: tipo[0] + tipo.slice(1).toLowerCase(), peso_kg: peso, raw: line });
  }
  return rows;
}

router.post('/parse-pdf', (req, res) => {
  memUpload.single('pdf')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Archivo PDF requerido' });
    try {
      const pdfParse = require('pdf-parse/lib/pdf-parse');
      const data = await pdfParse(req.file.buffer);
      const primales_guess = tryParsePrimales(data.text || '');
      res.json({
        text: data.text || '',
        numpages: data.numpages,
        primales_guess,
        filename: req.file.originalname,
        size: req.file.size
      });
    } catch (e) { res.status(500).json({ error: 'Error parseando PDF: ' + e.message }); }
  });
});

module.exports = router;
