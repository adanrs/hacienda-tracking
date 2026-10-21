/**
 * Solicitud de deshuese — lógica pura, sin base de datos.
 *
 * Qué es: después de cada sacrificio el dueño le manda a la planta (CIISA) una hoja que dice,
 * canal por canal, qué cortes deshuesar y en cuántas medias canales (0, 1 o 2). Hasta ahora la
 * armaba en una hoja de cálculo aparte; esta es la versión dentro de la app.
 *
 * Forma de la hoja (inferida de los flujos del dueño, por confirmar con él):
 *   - Una solicitud por fecha de sacrificio.
 *   - Arriba, un bloque por canal: arete, sexo, peso en pie (finca y planta), peso canal,
 *     n.º de canal CIISA (consecutivo de sacrificio, p. ej. 5256), lote de deshuese (vacío,
 *     lo llena la planta) y peso de deshuese estimado (84 % del canal).
 *   - Abajo, una fila por corte: código CIISA, NAMP, nombre, medias por canal y observación.
 *
 * Aquí viven las constantes de negocio (para cambiarlas en un solo lugar), la validación del
 * cuerpo que manda la pantalla y el cálculo del peso estimado, para probarlos sin MySQL.
 */

// ── Supuestos de negocio (pendientes de confirmar con el dueño) ─────────────
// Cada uno está aislado en una constante para cambiarlo sin tocar las rutas ni la pantalla.

/** Peso de deshuese estimado = este factor × peso canal. */
const PCT_DESHUESE_EST = 0.84;

/**
 * Qué peso de canal se usa para el estimado: el frío si existe (el deshuese se hace con la
 * canal ya enfriada) y si no el caliente, que es el que CIISA pesa el día del sacrificio.
 */
const ORDEN_PESO_CANAL = ['peso_canal_frio', 'peso_canal_caliente'];

/** Medias con las que arranca cada celda de una solicitud nueva (2 = canal completa). */
const MEDIAS_DEFECTO = 2;

/**
 * Cortes que aparecen como filas: los activos del catálogo que la PLANTA saca de la canal.
 *  - serie ARREO = códigos de planta del catálogo CIISA v10 (anexo C4); serie NULL = códigos
 *    sembrados antes de v10 (solo quedan activos donde no se cargó el catálogo real).
 *  - tipos primal y otro (costillas, osobuco, rabo). Se dejan fuera trim/BCH/grasa (son el
 *    destino de lo que NO se pide: «0 para BCH») y los despojos, que no van por media canal.
 * Los cortes retail F1/FB (serie 266xx/263xx) salen del porcionado, no del deshuese.
 */
const FILTRO_CORTES = { series: ['ARREO'], incluirSinSerie: true, tipos: ['primal', 'otro'] };

const ESTADOS = ['borrador', 'enviada', 'deshuesada'];
const MEDIAS_VALIDAS = [0, 1, 2];

// Topes de tamaño: un día de sacrificio son decenas de canales y unas 30 filas de cortes.
const MAX_CANALES = 100;
const MAX_LINEAS = 300;
const MAX_OBS_SOLICITUD = 1000;
const MAX_OBS_LINEA = 300;
const MAX_ENVIADA_A = 200;

// N.º de canal: el consecutivo de sacrificio de CIISA (p. ej. 5256). Se guarda como texto por
// si la planta usa prefijos, pero solo letras, dígitos y guion, para que la llave única
// (fecha, número) no dependa de espacios o mayúsculas.
const RE_NUMERO_CANAL = /^[0-9A-Z-]{1,10}$/;
const RE_CODIGO_CORTE = /^[0-9A-Za-z-]{1,20}$/;

class ErrorValidacion extends Error {
  constructor(mensaje, detalles = []) {
    super(mensaje);
    this.name = 'ErrorValidacion';
    this.status = 400;
    this.detalles = detalles;
  }
}

const redondear = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
};

/** Fecha ISO válida (rechaza 2026-02-30). */
function esFechaIso(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Texto libre sin caracteres de control, recortado; '' → null. */
function textoLimpio(valor, max) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') return undefined; // la validación lo marca como error
  const s = valor.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? s.slice(0, max) : null;
}

/** N.º de canal normalizado (mayúsculas, sin espacios) o null si viene vacío; undefined si es inválido. */
function normalizarNumeroCanal(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string' && typeof valor !== 'number') return undefined;
  const s = String(valor).trim().toUpperCase();
  if (!s) return null;
  return RE_NUMERO_CANAL.test(s) ? s : undefined;
}

/**
 * Medias de una celda. Solo 0, 1 o 2 (número entero o el texto «0», «1», «2»): una canal tiene
 * dos medias, así que cualquier otro valor es un error de captura, no algo que se redondea.
 */
function parsearMedias(valor) {
  if (typeof valor === 'number' && MEDIAS_VALIDAS.includes(valor)) return valor;
  if (typeof valor === 'string' && /^[012]$/.test(valor.trim())) return Number(valor.trim());
  return null;
}

/** Peso de canal que se usa para el estimado y de dónde salió (frío o caliente). */
function pesoCanal(fila) {
  for (const col of ORDEN_PESO_CANAL) {
    const v = fila ? Number(fila[col]) : NaN;
    if (fila && fila[col] !== null && fila[col] !== undefined && Number.isFinite(v) && v > 0) {
      return { kg: v, origen: col === 'peso_canal_frio' ? 'frio' : 'caliente' };
    }
  }
  return { kg: null, origen: null };
}

/** Peso de deshuese estimado (kg, 2 decimales) o null si la canal no tiene peso. */
function pesoDeshueseEstimado(kgCanal, pct = PCT_DESHUESE_EST) {
  if (kgCanal === null || kgCanal === undefined || !Number.isFinite(Number(kgCanal)) || Number(kgCanal) <= 0) return null;
  return redondear(Number(kgCanal) * pct, 2);
}

/** ¿Este corte del catálogo va como fila de la solicitud? (ver FILTRO_CORTES) */
function corteEnSolicitud(c, filtro = FILTRO_CORTES) {
  if (!c || Number(c.activo) !== 1) return false;
  if (!filtro.tipos.includes(c.tipo)) return false;
  if (c.serie === null || c.serie === undefined || c.serie === '') return filtro.incluirSinSerie;
  return filtro.series.includes(c.serie);
}

const esIdPositivo = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2 ** 31)
  || (typeof v === 'string' && /^\d{1,10}$/.test(v) && Number(v) > 0 && Number(v) < 2 ** 31);

/**
 * Valida y normaliza el cuerpo de guardar una solicitud (alta o edición de un borrador):
 *   {
 *     fecha_sacrificio: 'AAAA-MM-DD',
 *     observaciones?: texto,
 *     canales: [{ sacrificio_id, numero_canal? }],            // en el orden de la hoja
 *     lineas:  [{ corte_codigo, observacion?, medias: { <sacrificio_id>: 0|1|2 } }]
 *   }
 * La matriz debe venir completa: cada línea trae las medias de TODAS las canales.
 * @returns {{ fecha, observaciones, canales: {sacrificio_id, numero_canal, orden}[], lineas: {corte_codigo, observacion, medias: Map<number, number>}[] }}
 * @throws {ErrorValidacion} con `detalles`
 */
function validarSolicitud(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErrorValidacion('El cuerpo de la solicitud debe ser un objeto JSON');
  }
  const errores = [];

  const fecha = body.fecha_sacrificio;
  if (!esFechaIso(fecha)) errores.push('Fecha de sacrificio inválida: use AAAA-MM-DD');

  const observaciones = textoLimpio(body.observaciones, MAX_OBS_SOLICITUD);
  if (observaciones === undefined) errores.push('Las observaciones deben ser texto');

  // ── Canales ──
  const canales = [];
  if (!Array.isArray(body.canales) || !body.canales.length) {
    errores.push('La solicitud debe tener al menos una canal');
  } else if (body.canales.length > MAX_CANALES) {
    errores.push(`Máximo ${MAX_CANALES} canales por solicitud`);
  } else {
    const vistos = new Set();
    const numeros = new Map();
    body.canales.forEach((c, i) => {
      const n = i + 1;
      if (!c || typeof c !== 'object') { errores.push(`Canal ${n}: formato inválido`); return; }
      if (!esIdPositivo(c.sacrificio_id)) { errores.push(`Canal ${n}: sacrificio_id inválido`); return; }
      const id = Number(c.sacrificio_id);
      if (vistos.has(id)) { errores.push(`Canal ${n}: el sacrificio ${id} viene repetido`); return; }
      vistos.add(id);
      const numero = normalizarNumeroCanal(c.numero_canal);
      if (numero === undefined) {
        errores.push(`Canal ${n}: n.º de canal inválido (solo dígitos, letras y guion, hasta 10)`);
        return;
      }
      if (numero !== null) {
        if (numeros.has(numero)) errores.push(`El n.º de canal ${numero} está repetido (canales ${numeros.get(numero)} y ${n})`);
        else numeros.set(numero, n);
      }
      canales.push({ sacrificio_id: id, numero_canal: numero, orden: canales.length + 1 });
    });
  }

  // ── Líneas (corte × canal) ──
  const lineas = [];
  if (!Array.isArray(body.lineas) || !body.lineas.length) {
    errores.push('La solicitud debe tener al menos un corte');
  } else if (body.lineas.length > MAX_LINEAS) {
    errores.push(`Máximo ${MAX_LINEAS} cortes por solicitud`);
  } else {
    const codigos = new Set();
    const idsCanal = canales.map((c) => c.sacrificio_id);
    body.lineas.forEach((l, i) => {
      const n = i + 1;
      if (!l || typeof l !== 'object') { errores.push(`Corte ${n}: formato inválido`); return; }
      const codigo = typeof l.corte_codigo === 'string' ? l.corte_codigo.trim() : String(l.corte_codigo ?? '');
      if (!RE_CODIGO_CORTE.test(codigo)) { errores.push(`Corte ${n}: código inválido`); return; }
      if (codigos.has(codigo)) { errores.push(`El corte ${codigo} viene repetido`); return; }
      codigos.add(codigo);
      const observacion = textoLimpio(l.observacion, MAX_OBS_LINEA);
      if (observacion === undefined) { errores.push(`Corte ${codigo}: la observación debe ser texto`); return; }
      if (!l.medias || typeof l.medias !== 'object' || Array.isArray(l.medias)) {
        errores.push(`Corte ${codigo}: faltan las medias por canal`);
        return;
      }
      const medias = new Map();
      const erroresAntes = errores.length;
      for (const [clave, valor] of Object.entries(l.medias)) {
        if (!/^\d{1,10}$/.test(clave) || !idsCanal.includes(Number(clave))) {
          errores.push(`Corte ${codigo}: trae medias de un sacrificio (${clave.slice(0, 12)}) que no está en las canales`);
          continue;
        }
        const m = parsearMedias(valor);
        if (m === null) {
          errores.push(`Corte ${codigo}: las medias solo pueden ser 0, 1 o 2 (llegó «${String(valor).slice(0, 10)}»)`);
          continue;
        }
        medias.set(Number(clave), m);
      }
      const faltan = idsCanal.filter((id) => !medias.has(id));
      // Si ya se reportó un valor inválido en esta fila, no se repite como «falta».
      if (faltan.length && errores.length === erroresAntes) {
        errores.push(`Corte ${codigo}: faltan las medias de ${faltan.length} canal(es)`);
      }
      lineas.push({ corte_codigo: codigo, observacion, medias });
    });
  }

  if (errores.length) throw new ErrorValidacion(errores[0], errores);
  return { fecha, observaciones, canales, lineas };
}

/** Destinatario del envío (texto libre, p. ej. «CIISA – planta El Arreo»); opcional. */
function validarEnvio(body) {
  const enviadaA = textoLimpio(body && body.enviada_a, MAX_ENVIADA_A);
  if (enviadaA === undefined) throw new ErrorValidacion('El destinatario debe ser texto');
  return { enviada_a: enviadaA };
}

module.exports = {
  PCT_DESHUESE_EST,
  ORDEN_PESO_CANAL,
  MEDIAS_DEFECTO,
  FILTRO_CORTES,
  ESTADOS,
  MEDIAS_VALIDAS,
  MAX_CANALES,
  MAX_LINEAS,
  ErrorValidacion,
  esFechaIso,
  normalizarNumeroCanal,
  parsearMedias,
  pesoCanal,
  pesoDeshueseEstimado,
  corteEnSolicitud,
  validarSolicitud,
  validarEnvio,
};
