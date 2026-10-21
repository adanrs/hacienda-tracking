// Solicitud de deshuese: lo que se le pide a la planta (CIISA) después de cada sacrificio,
// canal por canal y corte por corte (0, 1 o 2 medias canales). Ver lib/solicitudDeshuese.js.
//
// GET    /                      → lista de solicitudes con su estado
// GET    /config                → constantes de negocio (84 %, medias por defecto) para la pantalla
// GET    /por-fecha?fecha=      → la solicitud de esa fecha, o el borrador propuesto si no hay
// GET    /:id                   → la solicitud con sus canales y la matriz corte × canal
// GET    /:id/excel             → la hoja para la planta (.xlsx)
// POST   /                      → crea la solicitud de una fecha (una por fecha de sacrificio)
// PUT    /:id                   → guarda cambios de un BORRADOR
// POST   /:id/enviar            → borrador → enviada (no manda correo todavía: se descarga el Excel)
// POST   /:id/reabrir           → enviada → borrador, para corregir antes de reenviar
// POST   /:id/deshuesada        → enviada → deshuesada
// DELETE /:id                   → borra un borrador
//
// Permisos: se monta con `protegida` (index.js), igual que el resto de Planta: admin y operador
// escriben; el viewer solo lee (soloLecturaViewer corta todo POST/PUT/DELETE antes de llegar).
// Todo valor del request va por `?`; los nombres de tabla/columna son fijos en el código.

const router = require('express').Router();
const { idsNumericos } = require('../lib/params');
const { pool } = require('../models/database');
const sd = require('../lib/solicitudDeshuese');
const { construirLibroSolicitud } = require('../lib/solicitudDeshueseExcel');

idsNumericos(router);

class ErrorHttp extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

const envolver = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err instanceof sd.ErrorValidacion) return res.status(400).json({ error: err.message, detalles: err.detalles });
  if (err instanceof ErrorHttp) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(err.code)) {
    return res.status(409).json({ error: 'Otro usuario está guardando esta solicitud en este momento. Recargue y revise antes de volver a guardar.' });
  }
  console.error('[solicitudes-deshuese]', err);
  res.status(500).json({ error: 'Error interno al procesar la solicitud de deshuese' });
});

const usuarioId = (req) => (req.user && Number.isInteger(req.user.id) ? req.user.id : null);
const fechaCR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const fmtFecha = (col) => `DATE_FORMAT(${col}, '%Y-%m-%d')`; // evita el corrimiento de zona horaria de DATE → Date

// Hora de Costa Rica (UTC−6, sin horario de verano) desde UNIX_TIMESTAMP(): el contenedor y MySQL
// corren en UTC. Mismo criterio que routes/reporte-produccion.js.
const OFFSET_CR_S = -6 * 3600;
function horaCR(ts) {
  if (ts === null || ts === undefined || Number.isNaN(Number(ts))) return null;
  const iso = new Date((Number(ts) + OFFSET_CR_S) * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

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

// ── Lecturas ────────────────────────────────────────────────────────────────

const SQL_ENCABEZADO = `
  SELECT s.id, s.numero, ${fmtFecha('s.fecha_sacrificio')} AS fecha_sacrificio, s.estado, s.observaciones,
         UNIX_TIMESTAMP(s.enviada_en) AS enviada_ts, s.enviada_a,
         UNIX_TIMESTAMP(s.updated_at) AS actualizada_ts, u.nombre AS creado_por
  FROM solicitudes_deshuese s
  LEFT JOIN usuarios u ON u.id = s.creado_por`;

function encabezadoDe(f) {
  return {
    id: f.id,
    numero: Number(f.numero),
    fecha_sacrificio: f.fecha_sacrificio,
    estado: f.estado,
    observaciones: f.observaciones,
    enviada_en: horaCR(f.enviada_ts),
    enviada_a: f.enviada_a,
    actualizada: horaCR(f.actualizada_ts),
    creado_por: f.creado_por,
  };
}

/**
 * Canales (sacrificios) del día con lo que va en el encabezado de la hoja. El peso en pie de
 * finca sale del último transporte del animal que lo traiga; el de planta es sacrificios.peso_vivo.
 */
async function canalesDelDia(db, fecha, solicitudId = null) {
  // otra_*: la canal ya está en OTRA solicitud (un sacrificio solo va en una: uk_sc_sacrificio).
  // Pasa cuando se corrige la fecha de un sacrificio que ya se había pedido en otro día.
  const [filas] = await db.query(
    `SELECT s.id AS sacrificio_id, s.animal_id, a.numero_trazabilidad AS arete, a.sexo, a.nombre AS animal_nombre,
            s.peso_vivo, s.peso_canal_caliente, s.peso_canal_frio, s.numero_canal, s.resultado_inspeccion,
            (SELECT t.peso_pie_finca FROM transporte t
              WHERE t.animal_id = s.animal_id AND t.peso_pie_finca IS NOT NULL
              ORDER BY t.fecha_salida DESC, t.id DESC LIMIT 1) AS peso_pie_finca,
            o.id AS otra_id, o.numero AS otra_numero, ${fmtFecha('o.fecha_sacrificio')} AS otra_fecha, o.estado AS otra_estado
     FROM sacrificios s
     JOIN animales a ON a.id = s.animal_id
     LEFT JOIN solicitud_canales osc ON osc.sacrificio_id = s.id AND osc.solicitud_id <> ?
     LEFT JOIN solicitudes_deshuese o ON o.id = osc.solicitud_id
     WHERE s.fecha_dia = ?
     ORDER BY s.numero_canal IS NULL, CHAR_LENGTH(s.numero_canal), s.numero_canal, s.id`,
    [solicitudId || 0, fecha],
  );
  return filas.map((f) => {
    const canal = sd.pesoCanal(f);
    return {
      sacrificio_id: f.sacrificio_id,
      animal_id: f.animal_id,
      arete: f.arete,
      sexo: f.sexo,
      animal_nombre: f.animal_nombre,
      peso_pie_finca: f.peso_pie_finca === null ? null : Number(f.peso_pie_finca),
      peso_vivo: f.peso_vivo === null ? null : Number(f.peso_vivo),
      peso_canal: canal.kg,
      peso_canal_origen: canal.origen,
      numero_canal: f.numero_canal,
      resultado_inspeccion: f.resultado_inspeccion,
      peso_deshuese_est: sd.pesoDeshueseEstimado(canal.kg),
      en_otra_solicitud: f.otra_id ? { id: f.otra_id, numero: Number(f.otra_numero), fecha_sacrificio: f.otra_fecha, estado: f.otra_estado } : null,
    };
  });
}

/** Cortes del catálogo que van como filas de una solicitud nueva (ver FILTRO_CORTES). */
async function cortesDelCatalogo(db) {
  const [filas] = await db.query(
    'SELECT codigo, nombre, namp, tipo, serie, activo FROM catalogo_cortes WHERE activo = 1 ORDER BY codigo',
  );
  return filas.filter((c) => sd.corteEnSolicitud(c)).map((c) => ({ codigo: c.codigo, nombre: c.nombre, namp: c.namp || null }));
}

async function plantaActiva(db) {
  const [filas] = await db.query('SELECT nombre, marca_comercial FROM config_planta WHERE activa = 1 ORDER BY id LIMIT 1');
  return filas[0] || null;
}

/**
 * Arma el modelo que consume la pantalla y el Excel.
 *  - Sin solicitud: todas las canales del día y los cortes del catálogo con MEDIAS_DEFECTO.
 *  - Con solicitud: sus canales y su matriz guardadas. Si es BORRADOR se agregan, marcadas como
 *    `nuevo`, las canales del día y los cortes del catálogo que todavía no tiene (con el valor
 *    por defecto), para que no se pierda un sacrificio registrado después. Una solicitud enviada
 *    se muestra tal como se mandó.
 */
async function armarModelo(db, fecha, encabezado) {
  const todasDelDia = await canalesDelDia(db, fecha, encabezado ? encabezado.id : null);
  // Las que ya están en otra solicitud no se proponen (guardarlas fallaría): van aparte para
  // que la pantalla diga dónde están.
  const enOtra = todasDelDia.filter((c) => c.en_otra_solicitud);
  const delDia = todasDelDia.filter((c) => !c.en_otra_solicitud);
  const porSacrificio = new Map(delDia.map((c) => [c.sacrificio_id, c]));
  const editable = !encabezado || encabezado.estado === 'borrador';
  let canales;
  let cortes;
  let quitadas = 0;

  if (!encabezado) {
    canales = delDia.map((c) => ({ ...c, nuevo: false }));
    const catalogo = await cortesDelCatalogo(db);
    cortes = catalogo.map((c) => ({
      ...c, observacion: null, nuevo: false,
      medias: Object.fromEntries(canales.map((x) => [x.sacrificio_id, sd.MEDIAS_DEFECTO])),
    }));
  } else {
    const [guardadas] = await db.query(
      `SELECT sc.id, sc.sacrificio_id, sc.numero_canal, sc.orden, sc.peso_deshuese_est
       FROM solicitud_canales sc WHERE sc.solicitud_id = ? ORDER BY sc.orden, sc.id`,
      [encabezado.id],
    );
    canales = guardadas.map((g) => {
      const vivo = porSacrificio.get(g.sacrificio_id) || {};
      return {
        ...vivo,
        sacrificio_id: g.sacrificio_id,
        // Lo guardado manda en una solicitud enviada; en un borrador manda lo vigente del sacrificio.
        numero_canal: editable ? (vivo.numero_canal ?? g.numero_canal) : g.numero_canal,
        peso_deshuese_est: editable && vivo.peso_deshuese_est !== undefined ? vivo.peso_deshuese_est
          : (g.peso_deshuese_est === null ? null : Number(g.peso_deshuese_est)),
        fuera_de_fecha: !porSacrificio.has(g.sacrificio_id), // el sacrificio cambió de fecha después
        nuevo: false,
      };
    });
    if (editable) {
      // En un borrador, una canal cuyo sacrificio ya no es de esta fecha (lo corrigieron en
      // Sacrificio) se saca: guardarla fallaría la verificación. Se avisa con `canales_quitadas`.
      quitadas = canales.filter((c) => c.fuera_de_fecha).length;
      canales = canales.filter((c) => !c.fuera_de_fecha);
      const ya = new Set(canales.map((c) => c.sacrificio_id));
      for (const c of delDia) if (!ya.has(c.sacrificio_id)) canales.push({ ...c, nuevo: true });
    }

    const [lineas] = await db.query(
      `SELECT l.corte_codigo, l.medias, l.observacion, sc.sacrificio_id, c.nombre, c.namp
       FROM solicitud_lineas l
       JOIN solicitud_canales sc ON sc.id = l.solicitud_canal_id
       LEFT JOIN catalogo_cortes c ON c.codigo = l.corte_codigo
       WHERE l.solicitud_id = ?
       ORDER BY l.orden, l.corte_codigo, sc.orden`,
      [encabezado.id],
    );
    const porCorte = new Map();
    for (const l of lineas) {
      if (!porCorte.has(l.corte_codigo)) {
        porCorte.set(l.corte_codigo, { codigo: l.corte_codigo, nombre: l.nombre, namp: l.namp || null, observacion: null, medias: {}, nuevo: false });
      }
      const fila = porCorte.get(l.corte_codigo);
      fila.medias[l.sacrificio_id] = Number(l.medias);
      // La observación es por corte; se guarda repetida en cada celda de la fila (ver PUT).
      if (!fila.observacion && l.observacion) fila.observacion = l.observacion;
    }
    cortes = [...porCorte.values()];
    if (editable) {
      for (const c of await cortesDelCatalogo(db)) {
        if (!porCorte.has(c.codigo)) cortes.push({ ...c, observacion: null, medias: {}, nuevo: true });
      }
      for (const fila of cortes) {
        for (const canal of canales) {
          if (fila.medias[canal.sacrificio_id] === undefined) fila.medias[canal.sacrificio_id] = sd.MEDIAS_DEFECTO;
        }
      }
    }
  }

  return {
    fecha_sacrificio: fecha,
    solicitud: encabezado,
    editable,
    pct_deshuese_est: sd.PCT_DESHUESE_EST,
    medias_defecto: sd.MEDIAS_DEFECTO,
    canales_quitadas: quitadas,
    canales_en_otra: enOtra.map((c) => ({ sacrificio_id: c.sacrificio_id, animal_id: c.animal_id, arete: c.arete, solicitud: c.en_otra_solicitud })),
    planta: await plantaActiva(db),
    canales,
    cortes,
  };
}

async function encabezadoPorId(db, id) {
  const [filas] = await db.query(`${SQL_ENCABEZADO} WHERE s.id = ?`, [id]);
  if (!filas.length) throw new ErrorHttp(404, 'Solicitud de deshuese no encontrada');
  return encabezadoDe(filas[0]);
}

// GET /api/solicitudes-deshuese
router.get('/', envolver(async (req, res) => {
  const [filas] = await pool.query(
    `SELECT s.id, s.numero, ${fmtFecha('s.fecha_sacrificio')} AS fecha_sacrificio, s.estado,
            UNIX_TIMESTAMP(s.enviada_en) AS enviada_ts, s.enviada_a, u.nombre AS creado_por,
            (SELECT COUNT(*) FROM solicitud_canales sc WHERE sc.solicitud_id = s.id) AS canales
     FROM solicitudes_deshuese s
     LEFT JOIN usuarios u ON u.id = s.creado_por
     ORDER BY s.fecha_sacrificio DESC, s.id DESC
     LIMIT 200`,
  );
  res.json(filas.map((f) => ({
    id: f.id, numero: Number(f.numero), fecha_sacrificio: f.fecha_sacrificio, estado: f.estado,
    enviada_en: horaCR(f.enviada_ts), enviada_a: f.enviada_a, creado_por: f.creado_por, canales: Number(f.canales),
  })));
}));

// GET /api/solicitudes-deshuese/config
router.get('/config', (req, res) => {
  res.json({
    pct_deshuese_est: sd.PCT_DESHUESE_EST,
    medias_defecto: sd.MEDIAS_DEFECTO,
    medias_validas: sd.MEDIAS_VALIDAS,
    estados: sd.ESTADOS,
    filtro_cortes: sd.FILTRO_CORTES,
  });
});

// GET /api/solicitudes-deshuese/por-fecha?fecha=AAAA-MM-DD
router.get('/por-fecha', envolver(async (req, res) => {
  const fecha = req.query.fecha;
  if (!sd.esFechaIso(fecha)) throw new ErrorHttp(400, 'Parámetro fecha inválido: use AAAA-MM-DD');
  const [filas] = await pool.query(`${SQL_ENCABEZADO} WHERE s.fecha_sacrificio = ?`, [fecha]);
  res.json(await armarModelo(pool, fecha, filas.length ? encabezadoDe(filas[0]) : null));
}));

// GET /api/solicitudes-deshuese/:id
router.get('/:id', envolver(async (req, res) => {
  const enc = await encabezadoPorId(pool, req.params.id);
  res.json(await armarModelo(pool, enc.fecha_sacrificio, enc));
}));

// GET /api/solicitudes-deshuese/:id/excel
router.get('/:id/excel', envolver(async (req, res) => {
  const enc = await encabezadoPorId(pool, req.params.id);
  const modelo = await armarModelo(pool, enc.fecha_sacrificio, enc);
  if (!modelo.canales.length) throw new ErrorHttp(400, 'La solicitud no tiene canales');
  const libro = construirLibroSolicitud(modelo);
  const nombre = `solicitud-deshuese-${enc.numero}-${enc.fecha_sacrificio}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  await libro.xlsx.write(res);
  res.end();
}));

// ── Escrituras ──────────────────────────────────────────────────────────────

/**
 * Comprueba contra la base lo que la validación pura no puede: que cada sacrificio exista y sea
 * de la fecha de la solicitud, que los cortes existan en el catálogo y que el n.º de canal no lo
 * tenga otro sacrificio del mismo día. Devuelve los pesos de deshuese estimados por sacrificio.
 */
async function verificarContraBase(conn, v, solicitudId = null) {
  const ids = v.canales.map((c) => c.sacrificio_id);
  const [sacr] = await conn.query(
    `SELECT s.id, ${fmtFecha('s.fecha_dia')} AS fecha, s.peso_canal_caliente, s.peso_canal_frio, a.numero_trazabilidad AS arete
     FROM sacrificios s JOIN animales a ON a.id = s.animal_id
     WHERE s.id IN (?)`,
    [ids],
  );
  const porId = new Map(sacr.map((s) => [s.id, s]));
  const errores = [];
  for (const id of ids) {
    const s = porId.get(id);
    if (!s) errores.push(`El sacrificio ${id} no existe (¿lo borraron?). Recargue la pantalla.`);
    else if (s.fecha !== v.fecha) errores.push(`El animal ${s.arete} se sacrificó el ${s.fecha}, no el ${v.fecha}`);
  }
  const codigos = v.lineas.map((l) => l.corte_codigo);
  const [cat] = await conn.query('SELECT codigo FROM catalogo_cortes WHERE codigo IN (?)', [codigos]);
  const existentes = new Set(cat.map((c) => c.codigo));
  const faltan = codigos.filter((c) => !existentes.has(c));
  if (faltan.length) errores.push(`Cortes que no están en el catálogo: ${faltan.join(', ')}`);

  const numeros = v.canales.filter((c) => c.numero_canal !== null);
  if (numeros.length && !errores.length) {
    const [ocupados] = await conn.query(
      `SELECT s.id, s.numero_canal, a.numero_trazabilidad AS arete
       FROM sacrificios s JOIN animales a ON a.id = s.animal_id
       WHERE s.fecha_dia = ? AND s.numero_canal IN (?) AND s.id NOT IN (?)`,
      [v.fecha, numeros.map((c) => c.numero_canal), ids],
    );
    for (const o of ocupados) errores.push(`El n.º de canal ${o.numero_canal} ya lo tiene el animal ${o.arete} ese mismo día`);
  }
  if (!errores.length) {
    const [enOtra] = await conn.query(
      `SELECT sc.sacrificio_id, a.numero_trazabilidad AS arete, o.numero, ${fmtFecha('o.fecha_sacrificio')} AS fecha, o.estado
       FROM solicitud_canales sc
       JOIN solicitudes_deshuese o ON o.id = sc.solicitud_id
       JOIN sacrificios s ON s.id = sc.sacrificio_id
       JOIN animales a ON a.id = s.animal_id
       WHERE sc.sacrificio_id IN (?) AND sc.solicitud_id <> ?`,
      [ids, solicitudId || 0],
    );
    for (const o of enOtra) {
      errores.push(`El animal ${o.arete} ya está en la solicitud N.º ${o.numero} del ${fechaCR(o.fecha)} (${o.estado}). `
        + 'Quítelo de allá o corrija la fecha del sacrificio.');
    }
  }
  if (errores.length) throw new sd.ErrorValidacion(errores[0], errores);

  return new Map(ids.map((id) => [id, sd.pesoDeshueseEstimado(sd.pesoCanal(porId.get(id)).kg)]));
}

/** Escribe canales y matriz de una solicitud (borra lo anterior) y copia el n.º de canal al sacrificio. */
async function escribirContenido(conn, solicitudId, v, estimados) {
  await conn.query('DELETE FROM solicitud_canales WHERE solicitud_id = ?', [solicitudId]); // las líneas caen en cascada
  // n.º de canal → sacrificios: primero se limpian los de estas canales y luego se asignan, para
  // que intercambiar dos números en la misma edición no choque con la llave única a medio camino.
  const ids = v.canales.map((c) => c.sacrificio_id);
  await conn.query('UPDATE sacrificios SET numero_canal = NULL WHERE id IN (?)', [ids]);
  for (const c of v.canales) {
    if (c.numero_canal !== null) await conn.query('UPDATE sacrificios SET numero_canal = ? WHERE id = ?', [c.numero_canal, c.sacrificio_id]);
  }

  await conn.query(
    'INSERT INTO solicitud_canales (solicitud_id, sacrificio_id, numero_canal, orden, peso_deshuese_est) VALUES ?',
    [v.canales.map((c) => [solicitudId, c.sacrificio_id, c.numero_canal, c.orden, estimados.get(c.sacrificio_id)])],
  );
  const [insertadas] = await conn.query('SELECT id, sacrificio_id FROM solicitud_canales WHERE solicitud_id = ?', [solicitudId]);
  const canalPorSacrificio = new Map(insertadas.map((r) => [r.sacrificio_id, r.id]));

  const filas = [];
  v.lineas.forEach((l, i) => {
    for (const c of v.canales) {
      filas.push([solicitudId, l.corte_codigo, canalPorSacrificio.get(c.sacrificio_id), l.medias.get(c.sacrificio_id), l.observacion, i + 1]);
    }
  });
  await conn.query(
    'INSERT INTO solicitud_lineas (solicitud_id, corte_codigo, solicitud_canal_id, medias, observacion, orden) VALUES ?',
    [filas],
  );
}

function traducirDuplicado(e, fecha) {
  if (e && e.code === 'ER_DUP_ENTRY') {
    const msg = String(e.sqlMessage || e.message || '');
    if (/uk_sacrificio_canal_dia/.test(msg)) return new ErrorHttp(409, 'Ese n.º de canal ya lo tiene otro animal sacrificado el mismo día');
    if (/uk_sc_sacrificio/.test(msg)) return new ErrorHttp(409, 'Uno de los animales ya está en otra solicitud de deshuese. Recargue la pantalla para ver en cuál.');
    if (/uk_sd_fecha/.test(msg)) return new ErrorHttp(409, `Ya hay una solicitud de deshuese para el ${fecha}`);
    return new ErrorHttp(409, 'Otro usuario guardó esta solicitud al mismo tiempo. Recargue y revise.');
  }
  return e;
}

// POST /api/solicitudes-deshuese  — crea la solicitud de una fecha
router.post('/', envolver(async (req, res) => {
  const v = sd.validarSolicitud(req.body);
  const usuario = usuarioId(req);
  try {
    const id = await conReintentoPorDeadlock(() => enTransaccion(async (conn) => {
      const [existe] = await conn.query('SELECT id FROM solicitudes_deshuese WHERE fecha_sacrificio = ? FOR UPDATE', [v.fecha]);
      if (existe.length) {
        throw new ErrorHttp(409, `Ya hay una solicitud de deshuese para el ${v.fecha}. Ábrala desde la lista.`, { id: existe[0].id });
      }
      const estimados = await verificarContraBase(conn, v);
      // Consecutivo propio de la app (no lo asigna CIISA). La llave única cubre la carrera.
      const [[{ siguiente }]] = await conn.query('SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM solicitudes_deshuese FOR UPDATE');
      const [ins] = await conn.query(
        `INSERT INTO solicitudes_deshuese (numero, fecha_sacrificio, estado, observaciones, creado_por, actualizado_por)
         VALUES (?, ?, 'borrador', ?, ?, ?)`,
        [siguiente, v.fecha, v.observaciones, usuario, usuario],
      );
      await escribirContenido(conn, ins.insertId, v, estimados);
      return ins.insertId;
    }));
    const enc = await encabezadoPorId(pool, id);
    res.status(201).json(await armarModelo(pool, enc.fecha_sacrificio, enc));
  } catch (e) { throw traducirDuplicado(e, v.fecha); }
}));

/**
 * Dos altas simultáneas toman candados de rango (FOR UPDATE sobre una fecha que no existe y
 * sobre MAX(numero)) y MySQL aborta una con deadlock. Se reintenta UNA vez: en el segundo intento
 * la otra ya hizo commit y el caso termina en un 409 claro («ya hay una solicitud…») o en el alta.
 */
async function conReintentoPorDeadlock(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === 'ER_LOCK_DEADLOCK') return fn();
    throw e;
  }
}

/** Toma la solicitud con candado y exige el estado esperado. */
async function bloquear(conn, id, estadosPermitidos, accion) {
  const [filas] = await conn.query(`SELECT id, estado, ${fmtFecha('fecha_sacrificio')} AS fecha FROM solicitudes_deshuese WHERE id = ? FOR UPDATE`, [id]);
  if (!filas.length) throw new ErrorHttp(404, 'Solicitud de deshuese no encontrada');
  if (!estadosPermitidos.includes(filas[0].estado)) {
    throw new ErrorHttp(409, `No se puede ${accion}: la solicitud está «${filas[0].estado}»`, { estado: filas[0].estado });
  }
  return filas[0];
}

// PUT /api/solicitudes-deshuese/:id  — guarda un borrador (reemplaza canales y matriz)
router.put('/:id', envolver(async (req, res) => {
  const v = sd.validarSolicitud(req.body);
  const usuario = usuarioId(req);
  try {
    await enTransaccion(async (conn) => {
      const actual = await bloquear(conn, req.params.id, ['borrador'], 'editar');
      if (actual.fecha !== v.fecha) throw new ErrorHttp(400, 'La fecha de sacrificio de una solicitud no se cambia: cree otra para esa fecha');
      const estimados = await verificarContraBase(conn, v, Number(req.params.id));
      await conn.query(
        'UPDATE solicitudes_deshuese SET observaciones = ?, actualizado_por = ? WHERE id = ?',
        [v.observaciones, usuario, req.params.id],
      );
      await escribirContenido(conn, Number(req.params.id), v, estimados);
    });
  } catch (e) { throw traducirDuplicado(e, v.fecha); }
  const enc = await encabezadoPorId(pool, req.params.id);
  res.json(await armarModelo(pool, enc.fecha_sacrificio, enc));
}));

// POST /api/solicitudes-deshuese/:id/enviar  { enviada_a? }
// Solo cambia el estado y registra cuándo y a quién: el envío por correo es fase 2.
router.post('/:id/enviar', envolver(async (req, res) => {
  const { enviada_a: enviadaA } = sd.validarEnvio(req.body);
  const usuario = usuarioId(req);
  await enTransaccion(async (conn) => {
    await bloquear(conn, req.params.id, ['borrador'], 'marcar como enviada');
    // La planta necesita el n.º de canal para ubicar cada canal en la cámara: sin él no se envía.
    const [sinNumero] = await conn.query(
      `SELECT a.numero_trazabilidad AS arete
       FROM solicitud_canales sc
       JOIN sacrificios s ON s.id = sc.sacrificio_id
       JOIN animales a ON a.id = s.animal_id
       WHERE sc.solicitud_id = ? AND (sc.numero_canal IS NULL OR sc.numero_canal = '')`,
      [req.params.id],
    );
    if (sinNumero.length) {
      throw new ErrorHttp(400, `Falta el n.º de canal de: ${sinNumero.map((f) => f.arete).join(', ')}. Complételo y guarde antes de enviar.`);
    }
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM solicitud_canales WHERE solicitud_id = ?', [req.params.id]);
    if (!Number(n)) throw new ErrorHttp(400, 'La solicitud no tiene canales');
    await conn.query(
      `UPDATE solicitudes_deshuese SET estado = 'enviada', enviada_en = CURRENT_TIMESTAMP, enviada_a = ?, actualizado_por = ? WHERE id = ?`,
      [enviadaA, usuario, req.params.id],
    );
  });
  const enc = await encabezadoPorId(pool, req.params.id);
  res.json(await armarModelo(pool, enc.fecha_sacrificio, enc));
}));

// POST /api/solicitudes-deshuese/:id/reabrir  — enviada → borrador (corregir y reenviar)
router.post('/:id/reabrir', envolver(async (req, res) => {
  await enTransaccion(async (conn) => {
    await bloquear(conn, req.params.id, ['enviada'], 'reabrir');
    await conn.query(
      `UPDATE solicitudes_deshuese SET estado = 'borrador', actualizado_por = ? WHERE id = ?`,
      [usuarioId(req), req.params.id],
    );
  });
  const enc = await encabezadoPorId(pool, req.params.id);
  res.json(await armarModelo(pool, enc.fecha_sacrificio, enc));
}));

// POST /api/solicitudes-deshuese/:id/deshuesada  — enviada → deshuesada
router.post('/:id/deshuesada', envolver(async (req, res) => {
  await enTransaccion(async (conn) => {
    await bloquear(conn, req.params.id, ['enviada'], 'marcar como deshuesada');
    // TODO(fase 2): al deshuesar, enlazar cada canal con su lote CC del día (lotes_cc_aretes /
    // lotes_deshuese del núcleo v10) y comparar lo pedido con el Reporte Diario de Producción.
    // Hoy solo se registra el estado; el lote de deshuese de la hoja lo sigue llenando la planta.
    await conn.query(
      `UPDATE solicitudes_deshuese SET estado = 'deshuesada', actualizado_por = ? WHERE id = ?`,
      [usuarioId(req), req.params.id],
    );
  });
  const enc = await encabezadoPorId(pool, req.params.id);
  res.json(await armarModelo(pool, enc.fecha_sacrificio, enc));
}));

// DELETE /api/solicitudes-deshuese/:id  — solo borradores (una enviada ya la tiene la planta)
router.delete('/:id', envolver(async (req, res) => {
  await enTransaccion(async (conn) => {
    await bloquear(conn, req.params.id, ['borrador'], 'eliminar');
    // El n.º de canal se queda en sacrificios: es un dato del sacrificio, no de la solicitud.
    await conn.query('DELETE FROM solicitudes_deshuese WHERE id = ?', [req.params.id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
