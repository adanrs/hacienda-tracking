// Importador masivo genérico: planificar (vista previa) → aplicar, por formato.
//
//   GET  /api/importaciones/formatos                 → formatos disponibles
//   POST /api/importaciones/:formato/planificar      → multipart «archivo» o JSON { pegado: { html, texto } }
//                                                      + «opciones» (JSON). No escribe nada.
//   POST /api/importaciones/:formato/aplicar         → lo mismo + «huella» de la vista previa aprobada.
//   GET  /api/importaciones?formato=                 → historial (quién, cuándo, resumen)
//   GET  /api/importaciones/:id                      → una importación con su bitácora
//
// Permisos: se monta con `protegida` (viewer solo lee: no puede planificar ni aplicar, porque
// ambos son POST). Todo valor del request va por `?`; el procesador escribe con columnas fijas.

const router = require('express').Router();
const multer = require('multer');
const { idsNumericos } = require('../lib/params');
const { pool } = require('../models/database');
const motor = require('../lib/importador/motor');
const { formatosHabilitados, formato } = require('../lib/importador/formatos');

idsNumericos(router);

const MAX_ARCHIVO = 5 * 1024 * 1024; // un reporte de hato o un correo con su tabla: 5 MB sobra
const MAX_PEGADO = 2 * 1024 * 1024;
const FORMATO_VALIDO = /^[a-z0-9-]{1,40}$/;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ARCHIVO, files: 1, fields: 10, fieldSize: MAX_PEGADO } });

const envolver = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err instanceof motor.ErrorImportacion) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error('[importaciones]', err);
  res.status(500).json({ error: 'Error interno al importar' });
});

// multer solo si el pedido es multipart; con JSON (texto pegado) pasa directo.
const archivoOpcional = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  upload.single('archivo')(req, res, (err) => {
    if (!err) return next();
    const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 5 MB' : 'No se pudo recibir el archivo';
    res.status(400).json({ error: mensaje });
  });
};

function jsonCampo(valor, nombre) {
  if (valor == null || valor === '') return {};
  if (typeof valor === 'object') return valor;
  try {
    const v = JSON.parse(valor);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch (_) { throw new motor.ErrorImportacion(400, `«${nombre}» no es JSON válido`); }
}

/** Entrada + opciones a partir del request (multipart o JSON). */
function leerPedido(req) {
  const { formato: id } = req.params;
  if (!FORMATO_VALIDO.test(id) || !formato(id)) throw new motor.ErrorImportacion(404, 'Formato de importación desconocido');
  const body = req.body || {};
  const opciones = jsonCampo(body.opciones, 'opciones');
  let entrada;
  if (req.file && req.file.buffer && req.file.buffer.length) {
    const nombre = String(req.file.originalname || 'archivo').replace(/[\u0000-\u001f]/g, '').slice(0, 255);
    entrada = { archivo: { buffer: req.file.buffer, nombre } };
  } else {
    const pegado = jsonCampo(body.pegado, 'pegado');
    const html = typeof pegado.html === 'string' ? pegado.html : '';
    const texto = typeof pegado.texto === 'string' ? pegado.texto : '';
    if (html.length + texto.length > MAX_PEGADO) throw new motor.ErrorImportacion(400, 'El texto pegado es demasiado grande');
    entrada = { pegado: { html, texto } };
  }
  return { id, entrada, opciones, huella: typeof body.huella === 'string' ? body.huella : null };
}

router.get('/formatos', (req, res) => res.json(formatosHabilitados()));

router.post('/:formato/planificar', archivoOpcional, envolver(async (req, res) => {
  const { id, entrada, opciones } = leerPedido(req);
  res.json(await motor.planificar(pool, id, entrada, opciones));
}));

router.post('/:formato/aplicar', archivoOpcional, envolver(async (req, res) => {
  const { id, entrada, opciones, huella } = leerPedido(req);
  const r = await motor.aplicar(pool, id, entrada, opciones, { usuarioId: req.user && req.user.id, huella });
  res.status(201).json(r);
}));

router.get('/', envolver(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.formato) { where = 'WHERE i.formato = ?'; params.push(String(req.query.formato)); }
  const [rows] = await pool.query(
    `SELECT i.id, i.formato, i.origen, i.archivo_nombre, i.resumen, i.metadatos, i.created_at, u.nombre AS usuario
     FROM importaciones i LEFT JOIN usuarios u ON u.id = i.usuario_id
     ${where} ORDER BY i.id DESC LIMIT 100`, params);
  res.json(rows);
}));

router.get('/:id', envolver(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.*, u.nombre AS usuario FROM importaciones i LEFT JOIN usuarios u ON u.id = i.usuario_id WHERE i.id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Importación no encontrada' });
  const [bitacora] = await pool.query(
    'SELECT fila, entidad, entidad_id, accion, detalle FROM importaciones_bitacora WHERE importacion_id = ? ORDER BY id', [req.params.id]);
  res.json({ ...rows[0], bitacora });
}));

module.exports = router;
