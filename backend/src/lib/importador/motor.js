// Motor del importador masivo: planificar → vista previa → aplicar.
//
// Por qué así (y no «subir y guardar»): el dueño carga reportes de decenas de animales y un
// archivo mal leído ensuciaría muchas fichas a la vez. Entonces:
//   1. planificar() lee el archivo (o el texto pegado), arma el plan fila por fila (nuevo /
//      actualizar con qué cambia / sin cambios / error) y NO escribe nada.
//   2. La pantalla muestra el plan y su `huella` (sha256 del plan).
//   3. aplicar() vuelve a planificar DENTRO de una transacción, con un candado con nombre (un
//      solo import a la vez) y compara la huella: si la base cambió desde la vista previa
//      responde 409 con el plan nuevo en vez de aplicar algo distinto de lo que se aprobó.
//      Luego el procesador escribe y se registran la importación y su bitácora; todo o nada.
// Re-importar el mismo archivo no duplica: cada procesador busca por clave natural
// (animal + fecha + tipo; guía por día + finca + comprador; sacrificio por canal + día).

const crypto = require('crypto');
const { formato } = require('./formatos');
const { leerArchivo, leerPegado, ErrorArchivo } = require('./archivos');
const { leerHojas } = require('./tabla');
const procesadores = require('./procesadores');

class ErrorImportacion extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}

const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');
const NOMBRE_CANDADO = 'hacienda_importador';

function definicion(formatoId) {
  const def = formato(formatoId);
  if (!def || !def.procesador || !procesadores[def.procesador]) throw new ErrorImportacion(404, 'Formato de importación desconocido');
  return { def, proc: procesadores[def.procesador] };
}

/**
 * Lee la entrada: { archivo: { buffer, nombre } } o { pegado: { html, texto } }.
 * Devuelve las hojas crudas, los textos sueltos y la huella del contenido.
 */
async function leerEntrada(entrada, def) {
  if (entrada.archivo) {
    const { buffer, nombre } = entrada.archivo;
    const ext = (String(nombre).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (!def.extensiones.includes(ext)) {
      throw new ErrorImportacion(400, `Este formato acepta archivos ${def.extensiones.map(e => `.${e}`).join(', ')}`);
    }
    try {
      const r = await leerArchivo(buffer, nombre);
      return { ...r, origen: 'archivo', archivo_nombre: nombre, sha: sha256(buffer) };
    } catch (e) {
      if (e instanceof ErrorArchivo) throw new ErrorImportacion(400, e.message);
      throw e;
    }
  }
  if (entrada.pegado && (entrada.pegado.html || entrada.pegado.texto)) {
    let r;
    try { r = leerPegado(entrada.pegado); } catch (e) {
      if (e instanceof ErrorArchivo) throw new ErrorImportacion(400, e.message);
      throw e;
    }
    return { ...r, origen: 'pegado', archivo_nombre: null, sha: sha256(String(entrada.pegado.html || '') + '\u0000' + String(entrada.pegado.texto || '')) };
  }
  throw new ErrorImportacion(400, 'Adjunte un archivo o pegue la tabla');
}

/**
 * Formatos de «documentos» (def.modo === 'documentos'): cada archivo es un documento entero (p. ej.
 * un PDF de CIISA = un animal) y no una tabla con encabezado. Se aceptan VARIOS archivos a la vez
 * más el texto pegado; el procesador recibe [{ nombre, texto, buffer, ext }] y arma su plan. La
 * huella del contenido cubre todos los archivos en orden, así que aplicar exige exactamente la
 * misma tanda que se vio en la vista previa.
 */
const MAX_DOCUMENTOS = 40;
async function leerDocumentos(entrada, def) {
  const archivos = [...(entrada.archivos || []), ...(entrada.archivo ? [entrada.archivo] : [])];
  if (archivos.length > MAX_DOCUMENTOS) throw new ErrorImportacion(400, `Máximo ${MAX_DOCUMENTOS} archivos por tanda`);
  const documentos = [];
  const hash = crypto.createHash('sha256');
  for (const a of archivos) {
    const ext = (String(a.nombre).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (!def.extensiones.includes(ext)) throw new ErrorImportacion(400, `«${a.nombre}»: este formato acepta ${def.extensiones.map(e => `.${e}`).join(', ')}`);
    let texto = null;
    if (!def.leerCrudo) {
      try {
        const r = await leerArchivo(a.buffer, a.nombre);
        texto = r.texto != null ? r.texto : r.hojas.map(h => h.filas.map(f => f.join('\t')).join('\n')).join('\n');
      } catch (e) {
        // Un PDF escaneado no frena la tanda: queda marcado para la lectura por foto (visión).
        if (e instanceof ErrorArchivo && e.codigo === 'sin_texto') { texto = ''; } else if (e instanceof ErrorArchivo) throw new ErrorImportacion(400, `«${a.nombre}»: ${e.message}`);
        else throw e;
      }
    }
    documentos.push({ nombre: a.nombre, ext, texto, buffer: a.buffer, requiereVision: texto === '' });
    hash.update(sha256(a.buffer)).update(String(a.nombre));
  }
  const pegado = entrada.pegado ? String(entrada.pegado.texto || '') : '';
  if (pegado.trim()) {
    documentos.push({ nombre: null, ext: null, texto: pegado, buffer: null, pegado: true });
    hash.update('pegado').update(pegado);
  }
  if (!documentos.length) throw new ErrorImportacion(400, 'Adjunte uno o más archivos, o pegue el texto');
  return {
    documentos, origen: archivos.length ? 'archivo' : 'pegado',
    archivo_nombre: archivos.length ? archivos.map(a => a.nombre).join(', ').slice(0, 255) : null,
    sha: hash.digest('hex'),
  };
}

/** Plan sin escribir nada. `conn` puede ser el pool o una conexión con transacción abierta. */
async function planificar(conn, formatoId, entrada, opciones = {}) {
  const { def, proc } = definicion(formatoId);
  if (def.modo === 'documentos') {
    const lectura = await leerDocumentos(entrada, def);
    const plan = await proc.planificar(conn, null, opciones, { def, lectura });
    const completo = { formato: formatoId, archivo_nombre: lectura.archivo_nombre, origen: lectura.origen, hoja: null, encabezado: null, metadatos: {}, ...plan };
    completo.resumen = resumir(completo.filas, completo.resumen);
    completo.huella = sha256(JSON.stringify(completo));
    completo.contenido_sha256 = lectura.sha;
    // Los buffers no van a la vista previa (ni a la huella); el procesador los usa al aplicar.
    Object.defineProperty(completo, '_documentos', { value: lectura.documentos, enumerable: false });
    return completo;
  }
  const lectura = await leerEntrada(entrada, def);
  const tabla = leerHojas(lectura.hojas, def, { textosExtra: lectura.textos });
  if (!tabla.encabezado) {
    const esperadas = def.columnas.filter(c => c.obligatoria).map(c => c.encabezados[0]);
    throw new ErrorImportacion(400, `No se encontró la fila de encabezados. Se esperaban columnas como: ${def.columnas.slice(0, 8).map(c => c.encabezados[0]).join(', ')}.`, { esperadas });
  }
  if (tabla.encabezado.faltantes.length) {
    throw new ErrorImportacion(400, `Faltan columnas obligatorias: ${tabla.encabezado.faltantes.join(', ')}`);
  }
  if (!tabla.filas.length) throw new ErrorImportacion(400, 'El archivo no trae filas de datos debajo del encabezado');

  const plan = await proc.planificar(conn, tabla, opciones, { def, lectura });
  const completo = {
    formato: formatoId,
    archivo_nombre: lectura.archivo_nombre,
    origen: lectura.origen,
    hoja: tabla.hoja || null,
    encabezado: tabla.encabezado,
    metadatos: { ...tabla.metadatos, ...(lectura.asunto ? { asunto: lectura.asunto } : {}) },
    ...plan,
  };
  completo.resumen = resumir(completo.filas, completo.resumen);
  completo.huella = sha256(JSON.stringify(completo));
  completo.contenido_sha256 = lectura.sha;
  return completo;
}

function resumir(filas, extra = {}) {
  const r = { total: filas.length, nuevos: 0, actualizados: 0, sin_cambios: 0, errores: 0, con_avisos: 0 };
  for (const f of filas) {
    if (f.accion === 'nuevo') r.nuevos++;
    else if (f.accion === 'actualizar') r.actualizados++;
    else if (f.accion === 'sin_cambios') r.sin_cambios++;
    else if (f.accion === 'error') r.errores++;
    if (f.avisos && f.avisos.length) r.con_avisos++;
  }
  return { ...r, ...extra };
}

/**
 * Aplica en UNA transacción. `huella` es la del plan que vio el usuario.
 * Devuelve { importacion_id, resumen, resultado }.
 */
async function aplicar(pool, formatoId, entrada, opciones, { usuarioId, huella }) {
  const { proc } = definicion(formatoId);
  const conn = await pool.getConnection();
  let candado = false;
  try {
    // Un import a la vez: dos personas aplicando el mismo reporte crearían la misma guía dos veces.
    const [[c]] = await conn.query('SELECT GET_LOCK(?, 15) AS ok', [NOMBRE_CANDADO]);
    if (!c || Number(c.ok) !== 1) throw new ErrorImportacion(409, 'Hay otra importación en curso. Intente de nuevo en unos segundos.');
    candado = true;
    await conn.beginTransaction();
    const plan = await planificar(conn, formatoId, entrada, opciones);
    if (!huella || plan.huella !== huella) {
      throw new ErrorImportacion(409, 'Los datos cambiaron desde la vista previa. Revise la nueva vista previa y vuelva a aplicar.', { plan });
    }
    if (plan.errores_generales && plan.errores_generales.length) {
      throw new ErrorImportacion(400, plan.errores_generales.join(' '), { plan });
    }
    const aplicables = plan.filas.filter(f => f.accion !== 'error');
    if (!aplicables.length) throw new ErrorImportacion(400, 'No hay filas válidas para aplicar', { plan });

    const [ins] = await conn.query(
      `INSERT INTO importaciones (formato, origen, archivo_nombre, archivo_sha256, huella_plan, resumen, metadatos, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [formatoId, plan.origen, plan.archivo_nombre, plan.contenido_sha256, plan.huella,
        JSON.stringify(plan.resumen), JSON.stringify(plan.metadatos || {}), usuarioId || null]);
    const importacionId = ins.insertId;

    const bitacora = [];
    const registrar = (fila, entidad, entidadId, accion, detalle) => bitacora.push([importacionId, fila ?? null, entidad, entidadId ?? null, accion, detalle ? JSON.stringify(detalle) : null]);
    for (const f of plan.filas.filter(x => x.accion === 'error')) registrar(f.fila, f.entidad || 'fila', null, 'omitido', { errores: f.errores });

    const resultado = await proc.aplicar(conn, plan, { importacionId, usuarioId, registrar, opciones });

    for (let i = 0; i < bitacora.length; i += 500) {
      await conn.query(
        'INSERT INTO importaciones_bitacora (importacion_id, fila, entidad, entidad_id, accion, detalle) VALUES ?',
        [bitacora.slice(i, i + 500)]);
    }
    const resumenFinal = { ...plan.resumen, aplicado: resultado.resumen || {} };
    await conn.query('UPDATE importaciones SET resumen = ? WHERE id = ?', [JSON.stringify(resumenFinal), importacionId]);
    await conn.commit();
    if (typeof proc.despuesDeCommit === 'function') {
      try { await proc.despuesDeCommit(pool, resultado); } catch (err) { console.error('[importador] despuesDeCommit', err.message); }
    }
    return { importacion_id: importacionId, resumen: resumenFinal, resultado };
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* sin transacción abierta */ }
    // Dos aplicar concurrentes sobre los mismos datos (p. ej. el mismo animal): la llave única o el
    // deadlock de MySQL frenan al que pierde y el rollback deja todo limpio. Para el usuario no es un
    // error interno sino un choque: 409 para que vuelva a ver la vista previa y reintente.
    if (e && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(e.code)) {
      throw new ErrorImportacion(409, 'Otra importación está aplicando sobre los mismos datos: reintente');
    }
    // Llave duplicada: NO es un choque pasajero (reintentar daría lo mismo): el archivo trae dos
    // filas que la base considera la misma, o alguien registró el dato entre la vista previa y aquí.
    if (e && e.code === 'ER_DUP_ENTRY') {
      throw new ErrorImportacion(409, 'Hay un registro repetido (el archivo trae dos filas que son el mismo dato, o ya se registró por otra vía). No se aplicó nada: revise la vista previa.', { detalle_mysql: String(e.sqlMessage || '').slice(0, 200) });
    }
    throw e;
  } finally {
    if (candado) { try { await conn.query('SELECT RELEASE_LOCK(?)', [NOMBRE_CANDADO]); } catch (_) { /* la conexión se cae y MySQL lo suelta */ } }
    conn.release();
  }
}

module.exports = { planificar, aplicar, ErrorImportacion, resumir };
