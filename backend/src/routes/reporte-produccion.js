// Reporte Diario de Producción (formato CIISA) con conciliación escaneado vs declarado.
//
// Fuentes:
//   - /escaneos  → etiquetas de deshuese (caja/primal) leídas con la pistola en la app.
//   - /ciisa     → el reporte que manda CIISA (importado de Excel/CSV o capturado a mano).
//   - /aretes    → la tabla posición → arete del correo de CIISA.
// GET /         → el reporte del día (por lote CC) con la conciliación por artículo.
// GET /excel    → el mismo reporte en Excel, con el formato del de CIISA.
//
// Permisos: se monta con `protegida` (index.js): admin y operador escriben; el viewer solo lee
// (soloLecturaViewer corta todo POST/PUT/DELETE antes de llegar aquí).
// Todo valor del request va por `?`; los nombres de tabla/columna son fijos en el código.

const router = require('express').Router();
const multer = require('multer');
const { idsNumericos, SOLO_DIGITOS } = require('../lib/params');
const { pool } = require('../models/database');
const rp = require('../lib/reporteProduccion');
const excel = require('../lib/reporteProduccionExcel');

idsNumericos(router);

const ORIGENES = ['excel_csv', 'manual', 'pegado', 'json'];
const MAX_ARCHIVO = 2 * 1024 * 1024; // un reporte diario son decenas de filas: 2 MB sobra
const fmtFecha = (col) => `DATE_FORMAT(${col}, '%Y-%m-%d')`; // evita el corrimiento de zona horaria de DATE → Date

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVO, files: 1 },
  fileFilter: (req, file, cb) => {
    // El tipo MIME lo pone el navegador y varía (Excel en Windows manda CSV como
    // application/vnd.ms-excel); se decide por extensión y luego por contenido.
    if (!/\.(xlsx|csv|txt)$/i.test(file.originalname || '')) {
      return cb(Object.assign(new Error('Solo se aceptan archivos .xlsx o .csv (un .xls viejo: ábralo en Excel y guárdelo como .xlsx)'), { status: 400 }));
    }
    cb(null, true);
  },
});

// ── Utilidades ──────────────────────────────────────────────────────────────

class ErrorHttp extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

const envolver = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err instanceof rp.ErrorValidacion) return res.status(400).json({ error: err.message, detalles: err.detalles });
  if (err instanceof ErrorHttp) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error('[reporte-produccion]', err);
  res.status(500).json({ error: 'Error interno al procesar el reporte de producción' });
});

function fechaObligatoria(valor, nombre = 'fecha') {
  if (!rp.esFechaIso(valor)) throw new ErrorHttp(400, `Parámetro ${nombre} inválido: use AAAA-MM-DD`);
  return valor;
}

function loteOpcional(valor) {
  if (valor === undefined || valor === '') return null;
  const n = rp.parsearLoteCC(valor);
  if (!n) throw new ErrorHttp(400, 'Parámetro lote_cc inválido: número de 1 a 4 dígitos');
  return n;
}

// Hora de Costa Rica (UTC−6 todo el año, sin horario de verano) a partir de UNIX_TIMESTAMP().
// Por qué no DATE_FORMAT(created_at): el contenedor y MySQL corren en UTC, así que la hora salía
// 6 horas adelantada. UNIX_TIMESTAMP interpreta el DATETIME con la misma zona de la sesión que
// usó CURRENT_TIMESTAMP al guardarlo, así que el instante es correcto sea cual sea esa zona.
const OFFSET_CR_S = -6 * 3600;
function horaCR(ts, formato = 'iso') {
  if (ts === null || ts === undefined || Number.isNaN(Number(ts))) return null;
  const iso = new Date((Number(ts) + OFFSET_CR_S) * 1000).toISOString(); // ya desplazada: se leen los campos UTC
  if (formato === 'corta') return `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

const usuarioId = (req) => (req.user && Number.isInteger(req.user.id) ? req.user.id : null);

async function enTransaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* la conexión ya pudo haberse cerrado */ }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Guarda filas posición → arete de una fecha. Resuelve el animal por numero_trazabilidad
 * (en esta app el arete ES el número de trazabilidad) y el deshuese de ese animal ese día.
 * Con `reemplazarTodo` borra las posiciones de la fecha que ya no vienen (pantalla de aretes);
 * sin él solo agrega o corrige (aretes que llegan junto con un reporte).
 */
async function guardarAretes(conn, fecha, aretes, usuario, { reemplazarTodo = false } = {}) {
  if (reemplazarTodo) {
    if (aretes.length) {
      await conn.query('DELETE FROM lotes_cc_aretes WHERE fecha_deshuese = ? AND lote_cc NOT IN (?)', [fecha, aretes.map(a => a.posicion)]);
    } else {
      await conn.query('DELETE FROM lotes_cc_aretes WHERE fecha_deshuese = ?', [fecha]);
    }
  }
  if (!aretes.length) return { guardados: 0, sin_animal: [] };

  const [animales] = await conn.query(
    'SELECT id, numero_trazabilidad FROM animales WHERE numero_trazabilidad IN (?)',
    [aretes.map(a => a.arete)],
  );
  const animalPorArete = new Map(animales.map(a => [String(a.numero_trazabilidad).toUpperCase(), a.id]));
  const idsAnimal = [...new Set(animales.map(a => a.id))];
  const deshusePorAnimal = new Map();
  if (idsAnimal.length) {
    const [des] = await conn.query(
      'SELECT id, animal_id FROM deshuese WHERE DATE(fecha) = ? AND animal_id IN (?) ORDER BY id',
      [fecha, idsAnimal],
    );
    for (const d of des) if (!deshusePorAnimal.has(d.animal_id)) deshusePorAnimal.set(d.animal_id, d.id);
  }

  const filas = aretes.map(a => {
    const animalId = animalPorArete.get(a.arete) || null;
    return [fecha, a.posicion, a.arete, animalId, animalId ? deshusePorAnimal.get(animalId) || null : null, usuario];
  });
  await conn.query(
    `INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id, deshuese_id, registrado_por)
     VALUES ?
     ON DUPLICATE KEY UPDATE arete = VALUES(arete), animal_id = VALUES(animal_id),
       deshuese_id = VALUES(deshuese_id), registrado_por = VALUES(registrado_por)`,
    [filas],
  );
  return { guardados: filas.length, sin_animal: aretes.filter(a => !animalPorArete.has(a.arete)).map(a => a.arete) };
}

/**
 * Arma el reporte de un día: un bloque por lote CC que tenga reporte de CIISA o etiquetas
 * escaneadas, con la conciliación por artículo, más la tabla de aretes del día.
 */
async function cargarReporte(fecha, loteCC) {
  const filtroR = loteCC ? ' AND r.lote_cc = ?' : '';
  const filtroE = loteCC ? ' AND e.lote_cc = ?' : '';
  const params = loteCC ? [fecha, loteCC] : [fecha];

  const [encabezados] = await pool.query(
    `SELECT r.id, r.lote_cc, r.num_lote, r.tipo_produccion, r.origen, r.archivo_nombre,
            UNIX_TIMESTAMP(r.updated_at) AS actualizado_ts, u.nombre AS cargado_por
     FROM reporte_produccion r
     LEFT JOIN usuarios u ON u.id = r.cargado_por
     WHERE r.fecha_produccion = ?${filtroR}`,
    params,
  );
  const [lineas] = await pool.query(
    `SELECT r.lote_cc, l.articulo_codigo, l.descripcion, l.peso_kg, l.unidad, l.cajas
     FROM reporte_produccion_lineas l
     JOIN reporte_produccion r ON r.id = l.reporte_id
     WHERE r.fecha_produccion = ?${filtroR}
     ORDER BY r.lote_cc, l.linea`,
    params,
  );
  const [escaneos] = await pool.query(
    `SELECT e.lote_cc, e.articulo_codigo, MAX(c.nombre) AS descripcion,
            ROUND(SUM(e.peso_kg), 3) AS kg, COUNT(*) AS cajas
     FROM reporte_produccion_escaneos e
     LEFT JOIN catalogo_cortes c ON c.codigo = e.articulo_codigo
     WHERE e.fecha_deshuese = ?${filtroE}
     GROUP BY e.lote_cc, e.articulo_codigo`,
    params,
  );
  const [aretes] = await pool.query(
    `SELECT a.lote_cc AS posicion, a.arete, a.animal_id, a.deshuese_id, an.nombre AS animal_nombre
     FROM lotes_cc_aretes a
     LEFT JOIN animales an ON an.id = a.animal_id
     WHERE a.fecha_deshuese = ?
     ORDER BY a.lote_cc`,
    [fecha],
  );

  const lotes = new Set([...encabezados.map(e => e.lote_cc), ...escaneos.map(e => e.lote_cc)]);
  const bloques = [...lotes].map(Number).sort((a, b) => a - b).map(lote => {
    const enc = encabezados.find(e => Number(e.lote_cc) === lote) || null;
    const ciisa = lineas.filter(l => Number(l.lote_cc) === lote)
      .map(l => ({ articulo_codigo: l.articulo_codigo, descripcion: l.descripcion, peso_kg: Number(l.peso_kg), unidad: l.unidad, cajas: Number(l.cajas) }));
    const esc = escaneos.filter(e => Number(e.lote_cc) === lote)
      .map(e => ({ articulo_codigo: e.articulo_codigo, descripcion: e.descripcion, kg: Number(e.kg), cajas: Number(e.cajas) }));
    const { filas, resumen } = rp.conciliar(ciisa, esc);
    const arete = aretes.find(a => Number(a.posicion) === lote);
    return {
      lote_cc: lote,
      lote_texto: rp.loteTexto(lote),
      arete: arete ? arete.arete : null,
      animal_id: arete ? arete.animal_id : null,
      encabezado: enc ? {
        id: enc.id, num_lote: enc.num_lote, tipo_produccion: enc.tipo_produccion, origen: enc.origen,
        archivo_nombre: enc.archivo_nombre, actualizado: horaCR(enc.actualizado_ts), cargado_por: enc.cargado_por,
      } : null,
      filas,
      resumen,
    };
  });

  return {
    fecha,
    lote_cc: loteCC,
    tolerancia_kg: rp.TOLERANCIA_KG,
    lotes: bloques,
    aretes: aretes.map(a => ({ posicion: Number(a.posicion), arete: a.arete, animal_id: a.animal_id, animal_nombre: a.animal_nombre, deshuese_id: a.deshuese_id })),
  };
}

// ── Reporte ─────────────────────────────────────────────────────────────────

// GET /api/reporte-produccion?fecha=AAAA-MM-DD[&lote_cc=6]
router.get('/', envolver(async (req, res) => {
  const fecha = fechaObligatoria(req.query.fecha);
  res.json(await cargarReporte(fecha, loteOpcional(req.query.lote_cc)));
}));

// GET /api/reporte-produccion/excel?fecha=…[&lote_cc=…]  → .xlsx con el formato de CIISA
router.get('/excel', envolver(async (req, res) => {
  const fecha = fechaObligatoria(req.query.fecha);
  const lote = loteOpcional(req.query.lote_cc);
  const libro = excel.construirLibroReporte(await cargarReporte(fecha, lote));
  const nombre = `reporte-produccion-${fecha}${lote ? `-lote-${rp.loteTexto(lote)}` : ''}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  await libro.xlsx.write(res);
  res.end();
}));

// GET /api/reporte-produccion/plantilla  → plantilla de carga del reporte CIISA
router.get('/plantilla', envolver(async (req, res) => {
  const libro = excel.construirPlantilla();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-reporte-produccion-ciisa.xlsx"');
  await libro.xlsx.write(res);
  res.end();
}));

// GET /api/reporte-produccion/dias?desde=&hasta=  → días con datos (para el calendario de la pantalla)
router.get('/dias', envolver(async (req, res) => {
  const hasta = req.query.hasta ? fechaObligatoria(req.query.hasta, 'hasta') : new Date().toISOString().slice(0, 10);
  const desde = req.query.desde ? fechaObligatoria(req.query.desde, 'desde') : null;
  const [filas] = await pool.query(
    `SELECT fecha, SUM(ciisa) AS lotes_ciisa, SUM(escaneos) AS etiquetas
     FROM (
       SELECT ${fmtFecha('fecha_produccion')} AS fecha, 1 AS ciisa, 0 AS escaneos
       FROM reporte_produccion WHERE fecha_produccion <= ? AND (? IS NULL OR fecha_produccion >= ?)
       UNION ALL
       SELECT ${fmtFecha('fecha_deshuese')}, 0, 1
       FROM reporte_produccion_escaneos WHERE fecha_deshuese <= ? AND (? IS NULL OR fecha_deshuese >= ?)
     ) t
     GROUP BY fecha ORDER BY fecha DESC LIMIT 60`,
    [hasta, desde, desde, hasta, desde, desde],
  );
  res.json(filas.map(f => ({ fecha: f.fecha, lotes_ciisa: Number(f.lotes_ciisa), etiquetas: Number(f.etiquetas) })));
}));

// ── Reporte de CIISA ────────────────────────────────────────────────────────

// GET /api/reporte-produccion/ciisa/:id  → encabezado + filas (para corregir una captura)
router.get('/ciisa/:id', envolver(async (req, res) => {
  const [enc] = await pool.query(
    `SELECT id, ${fmtFecha('fecha_produccion')} AS fecha_produccion, lote_cc, num_lote, tipo_produccion, origen, archivo_nombre
     FROM reporte_produccion WHERE id = ?`,
    [req.params.id],
  );
  if (!enc.length) throw new ErrorHttp(404, 'Reporte no encontrado');
  const [lineas] = await pool.query(
    'SELECT articulo_codigo, descripcion, peso_kg, unidad, cajas FROM reporte_produccion_lineas WHERE reporte_id = ? ORDER BY linea',
    [req.params.id],
  );
  const r = enc[0];
  res.json({
    id: r.id,
    origen: r.origen,
    archivo_nombre: r.archivo_nombre,
    encabezado: { fechaProduccion: r.fecha_produccion, numLote: r.num_lote, tipoProduccion: r.tipo_produccion, loteCC: rp.loteTexto(r.lote_cc) },
    lineas: lineas.map(l => ({ articulo: l.articulo_codigo, descripcion: l.descripcion, peso: Number(l.peso_kg), unidad: l.unidad, cajas: Number(l.cajas) })),
  });
}));

// POST /api/reporte-produccion/ciisa  — guarda un reporte de CIISA.
// Cuerpo con la forma de docs/reporte-produccion-diaria/ejemplo-2026-09-21.json
// ({ encabezado, lineas, pie?, aretesPorPosicion? }) más { id?, origen?, archivo_nombre?, reemplazar? }.
//   - Sin `id` (alta): si ya hay un reporte para esa fecha y lote CC responde 409, salvo `reemplazar: true`.
//   - Con `id` (corrección de un reporte cargado): se actualiza ESE reporte aunque cambien la fecha
//     o el lote CC. Antes se insertaba otro y el original quedaba duplicado con la llave vieja.
//     Si la llave nueva ya la tiene OTRO reporte: 409, o con `reemplazar` ese otro se borra.
router.post('/ciisa', envolver(async (req, res) => {
  const v = rp.validarReporte(req.body);
  const origen = req.body.origen === undefined ? 'manual' : req.body.origen;
  if (!ORIGENES.includes(origen)) throw new ErrorHttp(400, `Origen inválido: debe ser uno de ${ORIGENES.join(', ')}`);
  const archivo = typeof req.body.archivo_nombre === 'string' ? req.body.archivo_nombre.replace(/[\u0000-\u001f]/g, '').slice(0, 255) || null : null;
  const reemplazar = req.body.reemplazar === true;
  let idEdicion = null;
  if (req.body.id !== undefined && req.body.id !== null) {
    if (!SOLO_DIGITOS.test(String(req.body.id))) throw new ErrorHttp(400, 'id de reporte inválido');
    idEdicion = Number(req.body.id);
  }
  const usuario = usuarioId(req);
  const llave = `${v.fecha} lote CC ${rp.loteTexto(v.lote_cc)}`;

  try {
    const resultado = await enTransaccion(async (conn) => {
      if (idEdicion) {
        const [orig] = await conn.query('SELECT id FROM reporte_produccion WHERE id = ? FOR UPDATE', [idEdicion]);
        if (!orig.length) throw new ErrorHttp(404, 'El reporte que intenta corregir ya no existe. Recargue la pantalla.');
      }
      const [existe] = await conn.query(
        'SELECT id FROM reporte_produccion WHERE fecha_produccion = ? AND lote_cc = ? FOR UPDATE',
        [v.fecha, v.lote_cc],
      );
      const otro = existe.length && existe[0].id !== idEdicion ? existe[0].id : null;
      if (otro && !reemplazar) {
        throw new ErrorHttp(409, `Ya hay un reporte de CIISA cargado para el ${llave}. ¿Desea reemplazarlo?`, { existe: true, id: otro });
      }
      // El reporte que ocupaba la llave se borra (sus filas caen en cascada) antes de reutilizarla.
      if (otro) await conn.query('DELETE FROM reporte_produccion WHERE id = ?', [otro]);

      let id = idEdicion;
      if (!id && existe.length) id = existe[0].id; // alta con reemplazar sobre la misma llave: se reutiliza la fila
      if (id) {
        await conn.query(
          `UPDATE reporte_produccion SET fecha_produccion = ?, lote_cc = ?, num_lote = ?, tipo_produccion = ?,
             origen = ?, archivo_nombre = ?, cargado_por = ? WHERE id = ?`,
          [v.fecha, v.lote_cc, v.num_lote, v.tipo_produccion, origen, archivo, usuario, id],
        );
        await conn.query('DELETE FROM reporte_produccion_lineas WHERE reporte_id = ?', [id]);
      } else {
        const [ins] = await conn.query(
          `INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, tipo_produccion, origen, archivo_nombre, cargado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [v.fecha, v.lote_cc, v.num_lote, v.tipo_produccion, origen, archivo, usuario],
        );
        id = ins.insertId;
      }
      await conn.query(
        'INSERT INTO reporte_produccion_lineas (reporte_id, linea, articulo_codigo, descripcion, peso_kg, unidad, cajas) VALUES ?',
        [v.lineas.map(l => [id, l.linea, l.articulo_codigo, l.descripcion, l.peso_kg, l.unidad, l.cajas])],
      );
      const aretes = await guardarAretes(conn, v.fecha, v.aretes, usuario);
      return { id, reemplazado: Boolean(idEdicion || existe.length), reemplazo_otro: otro, aretes };
    });
    res.status(resultado.reemplazado ? 200 : 201).json({
      id: resultado.id,
      reemplazado: resultado.reemplazado,
      reemplazo_otro: resultado.reemplazo_otro,
      fecha: v.fecha,
      lote_cc: v.lote_cc,
      totales: v.totales,
      filas: v.lineas.length,
      aretes_guardados: resultado.aretes.guardados,
      aretes_sin_animal: resultado.aretes.sin_animal,
      advertencias: v.advertencias,
    });
  } catch (e) {
    // Dos cargas simultáneas del mismo lote nuevo: el SELECT … FOR UPDATE sobre una llave que
    // no existe toma un candado de rango en ambas transacciones y MySQL aborta una con deadlock
    // (o la segunda choca con la llave única). Para el usuario es el mismo caso: 409, no 500.
    if (e && ['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(e.code)) {
      throw new ErrorHttp(409, `Otro usuario está guardando el reporte del ${llave} en este momento. Recargue y revise antes de volver a guardar.`);
    }
    throw e;
  }
}));

// DELETE /api/reporte-produccion/ciisa/:id
router.delete('/ciisa/:id', envolver(async (req, res) => {
  const [r] = await pool.query('DELETE FROM reporte_produccion WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) throw new ErrorHttp(404, 'Reporte no encontrado');
  res.json({ ok: true });
}));

// POST /api/reporte-produccion/ciisa/importar  (multipart, campo «archivo»: .xlsx o .csv)
// Solo LEE el archivo y devuelve la vista previa: nada se guarda hasta que el usuario revisa
// y confirma cada lote con POST /ciisa. Así un archivo mal armado no ensucia la base.
router.post('/ciisa/importar', (req, res, next) => {
  upload.single('archivo')(req, res, (err) => {
    if (!err) return next();
    const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 2 MB' : err.message;
    res.status(400).json({ error: mensaje });
  });
}, envolver(async (req, res) => {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) throw new ErrorHttp(400, 'Adjunte un archivo .xlsx o .csv en el campo «archivo»');
  const buf = req.file.buffer;
  const nombre = String(req.file.originalname || '').replace(/[\u0000-\u001f]/g, '').slice(0, 255);
  let resultado;
  let aretes = { aretes: [], errores: [] };

  if (/\.xlsx$/i.test(nombre)) {
    // Un .xlsx es un zip: si no empieza con «PK» no es Excel aunque diga .xlsx.
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ErrorHttp(400, 'El archivo no es un Excel .xlsx válido');
    let libro;
    try { libro = await excel.leerLibro(buf); } catch (err) {
      // Un libro desmedido (miles de filas o columnas) trae su propio mensaje; lo demás es un archivo dañado.
      if (err instanceof excel.ErrorLibro) throw new ErrorHttp(400, err.message);
      throw new ErrorHttp(400, 'No se pudo leer el Excel. Ábralo y guárdelo de nuevo como .xlsx');
    }
    for (const filas of libro.reporte) {
      const r = rp.reportesDesdeFilas(filas);
      if (r.reportes.length || !resultado) resultado = r;
      if (r.reportes.length) break;
    }
    if (!resultado) resultado = { reportes: [], errores: ['El Excel no tiene hojas'] };
    if (libro.aretes) aretes = rp.aretesDesdeFilas(libro.aretes);
  } else {
    // CSV de Excel en Windows suele venir en Windows-1252: si no es UTF-8 válido se lee como latin1.
    let texto;
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { texto = buf.toString('latin1'); }
    const { filas, separador } = rp.parsearCsv(texto);
    resultado = rp.reportesDesdeFilas(filas, { comaDecimal: separador === ';' });
  }

  // Los aretes de la hoja se asignan a cada reporte por fecha (o a todos si la hoja no trae fecha).
  const reportes = resultado.reportes.map(r => ({
    ...r,
    aretesPorPosicion: aretes.aretes
      .filter(a => !a.fecha || a.fecha === r.encabezado.fechaProduccion)
      .map(a => ({ posicion: rp.loteTexto(a.posicion), arete: a.arete })),
  }));
  res.json({ archivo_nombre: nombre, reportes, errores: [...resultado.errores, ...aretes.errores] });
}));

// ── Tabla posición → arete ──────────────────────────────────────────────────

// GET /api/reporte-produccion/aretes?fecha=
router.get('/aretes', envolver(async (req, res) => {
  const fecha = fechaObligatoria(req.query.fecha);
  const [filas] = await pool.query(
    `SELECT a.lote_cc AS posicion, a.arete, a.animal_id, a.deshuese_id, an.nombre AS animal_nombre
     FROM lotes_cc_aretes a LEFT JOIN animales an ON an.id = a.animal_id
     WHERE a.fecha_deshuese = ? ORDER BY a.lote_cc`,
    [fecha],
  );
  res.json(filas.map(f => ({ ...f, posicion: Number(f.posicion) })));
}));

// PUT /api/reporte-produccion/aretes  { fecha, aretes: [{ posicion, arete }] }
// Reemplaza la tabla completa del día (lo que no viene se borra), como la del correo de CIISA.
router.put('/aretes', envolver(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const fecha = fechaObligatoria(body.fecha);
  if (!Array.isArray(body.aretes) || body.aretes.length > 200) throw new ErrorHttp(400, '«aretes» debe ser una lista de hasta 200 filas');
  const errores = [];
  const aretes = rp.validarAretes(body.aretes, errores);
  if (errores.length) throw new rp.ErrorValidacion(errores[0], errores);
  const r = await enTransaccion(conn => guardarAretes(conn, fecha, aretes, usuarioId(req), { reemplazarTodo: true }));
  res.json({ fecha, guardados: r.guardados, sin_animal: r.sin_animal });
}));

// ── Etiquetas escaneadas ────────────────────────────────────────────────────

// GET /api/reporte-produccion/escaneos?fecha=[&lote_cc=]
router.get('/escaneos', envolver(async (req, res) => {
  const fecha = fechaObligatoria(req.query.fecha);
  const lote = loteOpcional(req.query.lote_cc);
  const [filas] = await pool.query(
    `SELECT e.id, e.codigo_crudo, e.copia, e.tipo, e.articulo_codigo, c.nombre AS descripcion, e.peso_kg,
            ${fmtFecha('e.fecha_deshuese')} AS fecha_deshuese, e.lote_cc, e.box_codigo, e.fecha_ambigua,
            UNIX_TIMESTAMP(e.created_at) AS escaneado_ts, u.nombre AS escaneado_por
     FROM reporte_produccion_escaneos e
     LEFT JOIN catalogo_cortes c ON c.codigo = e.articulo_codigo
     LEFT JOIN usuarios u ON u.id = e.escaneado_por
     WHERE e.fecha_deshuese = ?${lote ? ' AND e.lote_cc = ?' : ''}
     ORDER BY e.id DESC
     LIMIT 2000`,
    lote ? [fecha, lote] : [fecha],
  );
  res.json(filas.map(({ escaneado_ts: ts, ...f }) => ({ ...f, escaneado: horaCR(ts), peso_kg: Number(f.peso_kg), lote_cc: Number(f.lote_cc) })));
}));

// POST /api/reporte-produccion/escaneos
//   { codigo, tipo?: 'caja'|'primal', fecha_esperada?: 'AAAA-MM-DD', otra_caja?: true }
// Registra una etiqueta de deshuese. `tipo` resuelve una etiqueta ambigua; `fecha_esperada`
// (la fecha que el operador tiene elegida en pantalla) frena etiquetas de otro día;
// `otra_caja` confirma que una etiqueta idéntica a otra ya escaneada es una caja distinta.
router.post('/escaneos', envolver(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof body.codigo !== 'string' || !body.codigo.trim()) throw new ErrorHttp(400, 'Se requiere «codigo» (texto leído de la etiqueta)');
  if (body.codigo.length > 200) throw new ErrorHttp(400, 'Código demasiado largo');
  if (body.tipo !== undefined && body.tipo !== 'caja' && body.tipo !== 'primal') throw new ErrorHttp(400, 'tipo debe ser caja o primal');
  const esperada = body.fecha_esperada === undefined || body.fecha_esperada === '' ? null : fechaObligatoria(body.fecha_esperada, 'fecha_esperada');

  const r = rp.etiquetaParaReporte(body.codigo, body.tipo);
  if (!r.ok) throw new ErrorHttp(422, r.mensaje, { motivo: r.motivo, alternativas: r.alternativas });
  const e = r.etiqueta;
  if (esperada && e.fecha_deshuese !== esperada) {
    const pista = e.fecha_ambigua ? ' (el día es ≤ 12: revise que la fecha de la etiqueta se haya leído bien)' : '';
    throw new ErrorHttp(409, `La etiqueta es del deshuese del ${e.fecha_deshuese.split('-').reverse().join('/')} y usted está escaneando el ${esperada.split('-').reverse().join('/')}${pista}.`, { motivo: 'otra_fecha', fecha_etiqueta: e.fecha_deshuese });
  }

  const insertar = (copia) => pool.query(
    `INSERT INTO reporte_produccion_escaneos
       (codigo_crudo, copia, tipo, articulo_codigo, peso_kg, fecha_deshuese, lote_cc, box_codigo, sufijo, fecha_ambigua, decodificado, escaneado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.codigo_crudo, copia, e.tipo, e.articulo_codigo, e.peso_kg, e.fecha_deshuese, e.lote_cc, e.box_codigo, e.sufijo,
      e.fecha_ambigua ? 1 : 0, JSON.stringify(e.decodificado), usuarioId(req)],
  );

  let copia = 1;
  let ins;
  try {
    if (body.otra_caja === true) {
      // El primal trae un n.º de Box único: dos lecturas iguales son la misma caja, nunca dos.
      if (e.tipo !== 'caja') throw new ErrorHttp(409, 'Un primal tiene número de Box único: esta etiqueta ya está registrada.', { motivo: 'duplicada' });
      const [m] = await pool.query('SELECT COALESCE(MAX(copia), 0) AS n FROM reporte_produccion_escaneos WHERE codigo_crudo = ?', [e.codigo_crudo]);
      copia = Number(m[0].n) + 1;
    }
    [ins] = await insertar(copia);
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      const [prev] = await pool.query(
        `SELECT UNIX_TIMESTAMP(e.created_at) AS cuando_ts, u.nombre AS quien
         FROM reporte_produccion_escaneos e LEFT JOIN usuarios u ON u.id = e.escaneado_por
         WHERE e.codigo_crudo = ? ORDER BY e.copia LIMIT 1`,
        [e.codigo_crudo],
      );
      const p = prev[0] || {};
      p.cuando = horaCR(p.cuando_ts, 'corta');
      throw new ErrorHttp(409, `Esta etiqueta ya se escaneó${p.cuando ? ` el ${p.cuando}` : ''}${p.quien ? ` (${p.quien})` : ''}.`, {
        motivo: 'duplicada',
        // Solo una caja master puede repetir etiqueta (mismo artículo, peso, fecha y lote): lo confirma el operador.
        puede_confirmar: e.tipo === 'caja' && body.otra_caja !== true,
      });
    }
    throw err;
  }

  const [[resumen]] = await pool.query(
    'SELECT COUNT(*) AS cajas, ROUND(SUM(peso_kg), 2) AS kg FROM reporte_produccion_escaneos WHERE fecha_deshuese = ? AND lote_cc = ?',
    [e.fecha_deshuese, e.lote_cc],
  );
  const [aretes] = await pool.query('SELECT arete FROM lotes_cc_aretes WHERE fecha_deshuese = ? AND lote_cc = ?', [e.fecha_deshuese, e.lote_cc]);
  res.status(201).json({
    id: ins.insertId,
    copia,
    tipo: e.tipo,
    articulo_codigo: e.articulo_codigo,
    descripcion: e.descripcion,
    peso_kg: e.peso_kg,
    fecha_deshuese: e.fecha_deshuese,
    lote_cc: e.lote_cc,
    fecha_ambigua: e.fecha_ambigua,
    escaneado: horaCR(Math.floor(Date.now() / 1000)),
    arete: aretes.length ? aretes[0].arete : null,
    lote: { cajas: Number(resumen.cajas), kg: Number(resumen.kg) },
  });
}));

// DELETE /api/reporte-produccion/escaneos/:id  — quita una lectura equivocada
router.delete('/escaneos/:id', envolver(async (req, res) => {
  const [r] = await pool.query('DELETE FROM reporte_produccion_escaneos WHERE id = ?', [req.params.id]);
  if (!r.affectedRows) throw new ErrorHttp(404, 'Lectura no encontrada');
  res.json({ ok: true });
}));

module.exports = router;
