/**
 * Reporte Diario de Producción (formato CIISA) — lógica pura, sin base de datos.
 *
 * El reporte se arma con dos fuentes (decisión de Adán, 13-oct-2026):
 *   1. Lo que se ESCANEA en la app: cada etiqueta de deshuese (caja o primal) es una caja
 *      del reporte y aporta artículo, kg, fecha de deshuese y n.º de deshuese (lote CC).
 *   2. Lo que DECLARA CIISA en su reporte diario (Excel/CSV, captura manual o pegado).
 * El valor está en conciliarlas: por lote CC y artículo, kg y cajas de un lado contra el otro.
 *
 * Aquí viven la validación de entradas, la lectura de tablas (Excel/CSV ya convertidos a
 * filas), los totales del pie y la conciliación, para poder probarlos sin MySQL ni Express.
 * Formato de referencia: docs/reporte-produccion-diaria/DISEÑO.md y ejemplo-2026-09-21.json.
 */

const { decodificar } = require('./etiquetas');
const { CATALOGO_POR_CODIGO } = require('../data/catalogo-ciisa');

// El pie de CIISA usa este factor: 319.82 kg × 2.20462 = 705.08 lb (verificado con la foto).
const LIBRAS_POR_KG = 2.20462;
// Diferencia de kg por artículo que todavía se considera «cuadra». CIISA reporta con 2
// decimales y las etiquetas traen centésimas, así que una diferencia menor a 1 centésima es
// redondeo. La tolerancia de negocio real (p. ej. ±0.5 kg o ±1 %) la debe fijar el cliente.
const TOLERANCIA_KG = 0.01;

const MAX_LINEAS = 500;
const MAX_ARETES = 200;
const UNIDADES = { KGS: 'KGS', KG: 'KGS', KILOS: 'KGS', KILOGRAMOS: 'KGS' };

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

/** Lote CC siempre con 2 dígitos en pantalla y Excel, como lo imprime CIISA («06»). */
const loteTexto = (n) => String(n).padStart(2, '0');

// ── Lectura de valores sueltos ──────────────────────────────────────────────

/** Fecha ISO válida (rechaza 2026-02-30). */
function esFechaIso(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * Acepta fecha ISO, DD/MM/AA, DD/MM/AAAA (formato de CR y del reporte CIISA: «21/09/26»)
 * y objetos Date que entrega exceljs para celdas de fecha. Devuelve ISO o null.
 * Nunca interpreta MM/DD: en Costa Rica el día va primero.
 */
function parsearFecha(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    // exceljs guarda las fechas de Excel como medianoche UTC: se leen en UTC para no correr un día.
    return valor.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  if (esFechaIso(s)) return s;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (iso && esFechaIso(iso[1])) return iso[1];
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const r = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return esFechaIso(r) ? r : null;
}

/**
 * Número desde texto de Excel/CSV. Acepta «97.40», «97,40» (coma decimal de un CSV con «;»)
 * y «1,234.56» / «1.234,56» (separador de miles). Devuelve NaN si no es un número limpio.
 * Con una sola coma y 3 cifras después («1,250») el texto es ambiguo: se toma como miles,
 * salvo `comaDecimal: true` (CSV separado por «;», donde la coma solo puede ser decimal).
 */
function parsearNumero(valor, { comaDecimal = false } = {}) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  if (valor == null) return NaN;
  let s = String(valor).trim().replace(/\s/g, '');
  if (!s) return NaN;
  const coma = s.lastIndexOf(',');
  const punto = s.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) {
    // El separador que aparece último es el decimal; el otro es de miles.
    if (coma > punto) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (coma >= 0) {
    // Solo coma: decimal si es la única y no tiene forma de miles («1,250»), o si el origen
    // garantiza coma decimal. «0,500» siempre es decimal (un miles no empieza en 0).
    const unica = /^-?\d+,\d{1,3}$/.test(s);
    const formaMiles = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s);
    s = unica && (comaDecimal || !formaMiles) ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Lote CC: «06», 6, «0006» (así viene en la caja) → 6. Rango 1–9999. */
function parsearLoteCC(valor) {
  const s = valor == null ? '' : String(valor).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 9999 ? n : null;
}

/** Arete como lo manda CIISA (72ELF, 347FLH, 0103-M): mayúsculas, sin espacios. */
function normalizarArete(valor) {
  const s = valor == null ? '' : String(valor).trim().toUpperCase().replace(/\s+/g, '');
  return /^[A-Z0-9]{1,10}(-[A-Z0-9]{1,5})?$/.test(s) && s.length >= 3 && s.length <= 10 ? s : null;
}

const textoLimpio = (v, max) => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

// ── Validación del reporte de CIISA ─────────────────────────────────────────

/**
 * Valida y normaliza un reporte de CIISA. Acepta la forma de `ejemplo-2026-09-21.json`
 * (encabezado + lineas + pie + aretesPorPosicion), que es la misma que arma la pantalla de
 * captura manual y la vista previa del importador.
 *
 * Si viene `pie` (totales que imprimió CIISA), se exige que cuadre con las filas: es el
 * control contra errores de transcripción (una fila omitida, un 97.40 digitado 9.74).
 *
 * @returns {{ fecha, lote_cc, num_lote, tipo_produccion, lineas: object[], aretes: object[],
 *             totales: object, advertencias: string[] }}
 * @throws {ErrorValidacion} con `detalles` por campo/fila
 */
function validarReporte(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ErrorValidacion('El reporte debe ser un objeto JSON');
  }
  const errores = [];
  const advertencias = [];
  const enc = body.encabezado && typeof body.encabezado === 'object' ? body.encabezado : {};

  const fecha = parsearFecha(enc.fechaProduccion);
  if (!fecha) errores.push('Fecha de producción inválida (use AAAA-MM-DD o DD/MM/AA)');
  const loteCC = parsearLoteCC(enc.loteCC);
  if (!loteCC) errores.push('Lote CC inválido: debe ser un número de 1 a 4 dígitos (p. ej. 06)');
  const numLote = textoLimpio(enc.numLote, 20);
  const tipoProduccion = textoLimpio(enc.tipoProduccion, 60);

  if (!Array.isArray(body.lineas) || body.lineas.length === 0) {
    errores.push('El reporte debe traer al menos una fila de artículo');
  } else if (body.lineas.length > MAX_LINEAS) {
    errores.push(`Demasiadas filas (${body.lineas.length}); el máximo es ${MAX_LINEAS}`);
  }

  const lineas = [];
  const vistos = new Map();
  (Array.isArray(body.lineas) ? body.lineas.slice(0, MAX_LINEAS) : []).forEach((l, i) => {
    const n = i + 1;
    if (!l || typeof l !== 'object' || Array.isArray(l)) { errores.push(`Fila ${n}: formato inválido`); return; }
    const articulo = String(l.articulo == null ? '' : l.articulo).trim();
    if (!/^\d{5}$/.test(articulo)) { errores.push(`Fila ${n}: el artículo «${articulo.slice(0, 20)}» debe ser un código CIISA de 5 dígitos`); return; }
    if (vistos.has(articulo)) {
      // CIISA imprime una fila por artículo; un repetido casi siempre es una fila pegada dos veces.
      errores.push(`Fila ${n}: el artículo ${articulo} ya está en la fila ${vistos.get(articulo)}`);
      return;
    }
    vistos.set(articulo, n);
    const peso = parsearNumero(l.peso);
    if (!Number.isFinite(peso) || peso <= 0 || peso > 10000) { errores.push(`Fila ${n} (${articulo}): peso inválido`); return; }
    if (redondear(peso, 3) !== peso) { errores.push(`Fila ${n} (${articulo}): el peso admite a lo sumo 3 decimales`); return; }
    const cajas = parsearNumero(l.cajas);
    if (!Number.isInteger(cajas) || cajas < 0 || cajas > 1000) { errores.push(`Fila ${n} (${articulo}): las cajas deben ser un número entero de 0 a 1000`); return; }
    const unidadCruda = String(l.unidad == null || l.unidad === '' ? 'KGS' : l.unidad).trim().toUpperCase();
    const unidad = UNIDADES[unidadCruda];
    if (!unidad) { errores.push(`Fila ${n} (${articulo}): unidad «${unidadCruda.slice(0, 10)}» no soportada; el reporte de CIISA viene en KGS`); return; }
    const catalogo = CATALOGO_POR_CODIGO[articulo];
    if (!catalogo) advertencias.push(`El artículo ${articulo} no está en el catálogo CIISA de la app`);
    lineas.push({
      linea: lineas.length + 1,
      articulo_codigo: articulo,
      descripcion: textoLimpio(l.descripcion, 200) || (catalogo ? catalogo.nombre : null),
      peso_kg: peso,
      unidad,
      cajas,
    });
  });

  const aretes = [];
  if (body.aretesPorPosicion != null) {
    if (!Array.isArray(body.aretesPorPosicion) || body.aretesPorPosicion.length > MAX_ARETES) {
      errores.push('La tabla de aretes debe ser una lista de hasta 200 filas');
    } else {
      aretes.push(...validarAretes(body.aretesPorPosicion, errores));
    }
  }

  // Lineas ordenadas por código, igual que el reporte impreso de CIISA.
  lineas.sort((a, b) => a.articulo_codigo.localeCompare(b.articulo_codigo));
  lineas.forEach((l, i) => { l.linea = i + 1; });
  const tot = totales(lineas);

  if (body.pie != null && typeof body.pie === 'object' && lineas.length) {
    const kilosPie = body.pie.kilos == null || body.pie.kilos === '' ? null : parsearNumero(body.pie.kilos);
    const cajasPie = body.pie.cajas == null || body.pie.cajas === '' ? null : parsearNumero(body.pie.cajas);
    if (kilosPie !== null && (!Number.isFinite(kilosPie) || Math.abs(kilosPie - tot.kilos) > TOLERANCIA_KG)) {
      errores.push(`El total de kilos del pie (${body.pie.kilos}) no cuadra con la suma de las filas (${tot.kilos.toFixed(2)}). Revise que no falte ni sobre una fila.`);
    }
    if (cajasPie !== null && cajasPie !== tot.cajas) {
      errores.push(`El total de cajas del pie (${body.pie.cajas}) no cuadra con la suma de las filas (${tot.cajas}).`);
    }
  }

  if (errores.length) throw new ErrorValidacion(errores[0], errores);
  return {
    fecha, lote_cc: loteCC, num_lote: numLote, tipo_produccion: tipoProduccion,
    lineas, aretes, totales: tot, advertencias,
  };
}

/** Valida la tabla posición → arete. Empuja los errores a `errores` y devuelve las filas válidas. */
function validarAretes(filas, errores) {
  const salida = [];
  const posiciones = new Map();
  filas.forEach((f, i) => {
    const n = i + 1;
    if (!f || typeof f !== 'object' || Array.isArray(f)) { errores.push(`Arete ${n}: formato inválido`); return; }
    const posicion = parsearLoteCC(f.posicion);
    const arete = normalizarArete(f.arete);
    if (!posicion) { errores.push(`Arete ${n}: posición «${String(f.posicion ?? '').slice(0, 10)}» inválida`); return; }
    if (!arete) { errores.push(`Arete ${n} (posición ${loteTexto(posicion)}): arete «${String(f.arete ?? '').slice(0, 15)}» inválido`); return; }
    if (posiciones.has(posicion)) { errores.push(`La posición ${loteTexto(posicion)} está repetida en la tabla de aretes`); return; }
    // Un animal se deshuesa una sola vez: el mismo arete en dos posiciones del día es un error de digitación.
    const otra = [...posiciones.entries()].find(([, a]) => a === arete);
    if (otra) { errores.push(`El arete ${arete} está en las posiciones ${loteTexto(otra[0])} y ${loteTexto(posicion)}`); return; }
    posiciones.set(posicion, arete);
    salida.push({ posicion, arete });
  });
  return salida.sort((a, b) => a.posicion - b.posicion);
}

/** Pie del reporte: kilos, libras (kilos × 2.20462) y cajas. */
function totales(lineas) {
  const kilos = redondear(lineas.reduce((s, l) => s + Number(l.peso_kg || 0), 0), 2);
  const cajas = lineas.reduce((s, l) => s + Number(l.cajas || 0), 0);
  return { kilos, libras: redondear(kilos * LIBRAS_POR_KG, 2), cajas };
}

// ── Importador de tablas (Excel / CSV / filas pegadas) ──────────────────────

/** Texto de encabezado sin tildes, signos ni mayúsculas: «Num. Lote» → «numlote». */
function claveEncabezado(texto) {
  return String(texto == null ? '' : texto)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Sinónimos aceptados por columna. La plantilla usa el primero de cada lista.
const COLUMNAS = {
  fecha: ['fecha', 'fechaproduccion', 'fechadeproduccion', 'fechadeshuese'],
  numLote: ['numlote', 'numerolote', 'nolote', 'lote'],
  tipoProduccion: ['tipoproduccion', 'tipo', 'tipodeproduccion'],
  loteCC: ['lotecc', 'posicion', 'lotedeshuese'],
  articulo: ['articulo', 'codigo', 'codigoarticulo', 'item'],
  descripcion: ['descripcion', 'nombre', 'producto'],
  peso: ['peso', 'pesokg', 'kilos', 'kg'],
  unidad: ['unidad', 'um'],
  cajas: ['cajas', 'cantidad', 'unidades'],
};
const OBLIGATORIAS = ['fecha', 'loteCC', 'articulo', 'peso', 'cajas'];
const COLUMNAS_PLANTILLA = ['Fecha', 'Num. Lote', 'Tipo producción', 'Lote CC', 'Artículo', 'Descripción', 'Peso', 'Unidad', 'Cajas'];

function mapearEncabezados(fila) {
  const mapa = {};
  fila.forEach((celda, i) => {
    const clave = claveEncabezado(celda);
    if (!clave) return;
    for (const [campo, sinonimos] of Object.entries(COLUMNAS)) {
      if (mapa[campo] === undefined && sinonimos.includes(clave)) { mapa[campo] = i; return; }
    }
  });
  return mapa;
}

/**
 * Convierte filas (arreglos de celdas) de un Excel, CSV o texto pegado en reportes CIISA
 * agrupados por fecha + lote CC. No guarda nada: es la vista previa que el usuario revisa.
 * La fila de encabezados se busca entre las primeras 20 (puede haber un título arriba).
 * @param {any[][]} filas
 * @param {{comaDecimal?: boolean}} [opciones]  true para CSV separado por «;»
 * @returns {{ reportes: object[], errores: string[] }}  reportes con la forma de validarReporte
 */
function reportesDesdeFilas(filas, { comaDecimal = false } = {}) {
  const errores = [];
  if (!Array.isArray(filas) || !filas.length) return { reportes: [], errores: ['El archivo está vacío'] };

  let inicio = -1;
  let mapa = null;
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const m = mapearEncabezados(filas[i] || []);
    if (m.articulo !== undefined && m.peso !== undefined) { inicio = i; mapa = m; break; }
  }
  if (inicio < 0) {
    return { reportes: [], errores: [`No se encontró la fila de títulos. Use la plantilla: ${COLUMNAS_PLANTILLA.join(', ')}`] };
  }
  const faltan = OBLIGATORIAS.filter(c => mapa[c] === undefined);
  if (faltan.length) {
    const nombres = { fecha: 'Fecha', loteCC: 'Lote CC', articulo: 'Artículo', peso: 'Peso', cajas: 'Cajas' };
    return { reportes: [], errores: [`Faltan columnas obligatorias: ${faltan.map(c => nombres[c]).join(', ')}`] };
  }

  const grupos = new Map();
  const celda = (fila, campo) => (mapa[campo] === undefined ? undefined : fila[mapa[campo]]);
  let filasDatos = 0;
  for (let i = inicio + 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    const vacia = fila.every(c => c == null || String(c).trim() === '');
    if (vacia) continue;
    const nFila = i + 1; // número de fila como lo ve el usuario en Excel
    const articulo = String(celda(fila, 'articulo') ?? '').trim();
    // Filas de totales («Total de Cajas por el Lote #…») o notas: se ignoran sin error.
    if (!/^\d/.test(articulo)) continue;
    filasDatos++;
    if (filasDatos > MAX_LINEAS * 10) { errores.push('El archivo trae demasiadas filas'); break; }
    const fecha = parsearFecha(celda(fila, 'fecha'));
    const loteCC = parsearLoteCC(celda(fila, 'loteCC'));
    if (!fecha) { errores.push(`Fila ${nFila}: fecha «${String(celda(fila, 'fecha') ?? '').slice(0, 20)}» inválida`); continue; }
    if (!loteCC) { errores.push(`Fila ${nFila}: lote CC «${String(celda(fila, 'loteCC') ?? '').slice(0, 10)}» inválido`); continue; }
    const llave = `${fecha}|${loteCC}`;
    if (!grupos.has(llave)) {
      grupos.set(llave, {
        encabezado: { fechaProduccion: fecha, numLote: null, tipoProduccion: null, loteCC: loteTexto(loteCC) },
        lineas: [],
        filasOrigen: [],
      });
    }
    const g = grupos.get(llave);
    const numLote = textoLimpio(celda(fila, 'numLote'), 20);
    const tipo = textoLimpio(celda(fila, 'tipoProduccion'), 60);
    if (numLote && !g.encabezado.numLote) g.encabezado.numLote = numLote;
    if (tipo && !g.encabezado.tipoProduccion) g.encabezado.tipoProduccion = tipo;
    const peso = parsearNumero(celda(fila, 'peso'), { comaDecimal });
    const cajas = parsearNumero(celda(fila, 'cajas'), { comaDecimal });
    g.lineas.push({
      articulo,
      descripcion: textoLimpio(celda(fila, 'descripcion'), 200),
      peso: Number.isFinite(peso) ? peso : String(celda(fila, 'peso') ?? ''),
      unidad: textoLimpio(celda(fila, 'unidad'), 10) || 'KGS',
      cajas: Number.isFinite(cajas) ? cajas : String(celda(fila, 'cajas') ?? ''),
    });
    g.filasOrigen.push(nFila);
  }

  // Cada grupo se valida igual que una captura manual; los errores se informan por grupo.
  const reportes = [];
  for (const g of grupos.values()) {
    const etiqueta = `${g.encabezado.fechaProduccion} lote CC ${g.encabezado.loteCC}`;
    try {
      const v = validarReporte({ encabezado: g.encabezado, lineas: g.lineas });
      reportes.push({
        encabezado: g.encabezado,
        lineas: v.lineas.map(l => ({ articulo: l.articulo_codigo, descripcion: l.descripcion, peso: l.peso_kg, unidad: l.unidad, cajas: l.cajas })),
        totales: v.totales,
        advertencias: v.advertencias,
      });
    } catch (e) {
      if (!(e instanceof ErrorValidacion)) throw e;
      for (const d of e.detalles) errores.push(`${etiqueta}: ${d}`);
      reportes.push({ encabezado: g.encabezado, lineas: g.lineas, totales: null, errores: e.detalles });
    }
  }
  if (!reportes.length && !errores.length) errores.push('El archivo no trae filas de artículos');
  return { reportes, errores };
}

/**
 * Tabla posición → arete desde filas (hoja «Aretes» de la plantilla o texto pegado).
 * Columnas: Fecha (opcional), Posición / Lote CC, Arete.
 * @returns {{ aretes: {fecha: string|null, posicion: number, arete: string}[], errores: string[] }}
 */
function aretesDesdeFilas(filas) {
  const errores = [];
  const aretes = [];
  if (!Array.isArray(filas) || !filas.length) return { aretes, errores };
  let inicio = -1;
  let iFecha;
  let iPos;
  let iArete;
  for (let i = 0; i < Math.min(filas.length, 20); i++) {
    const claves = (filas[i] || []).map(claveEncabezado);
    const p = claves.findIndex(c => ['posicion', 'lotecc', 'pos'].includes(c));
    const a = claves.indexOf('arete');
    if (p >= 0 && a >= 0) { inicio = i; iPos = p; iArete = a; iFecha = claves.indexOf('fecha'); break; }
  }
  if (inicio < 0) return { aretes, errores: ['La hoja de aretes necesita las columnas Posición y Arete'] };
  for (let i = inicio + 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    if (fila.every(c => c == null || String(c).trim() === '')) continue;
    const posicion = parsearLoteCC(fila[iPos]);
    const arete = normalizarArete(fila[iArete]);
    const fecha = iFecha >= 0 ? parsearFecha(fila[iFecha]) : null;
    if (!posicion || !arete) { errores.push(`Aretes, fila ${i + 1}: posición o arete inválido`); continue; }
    if (iFecha >= 0 && fila[iFecha] != null && String(fila[iFecha]).trim() !== '' && !fecha) {
      errores.push(`Aretes, fila ${i + 1}: fecha inválida`); continue;
    }
    aretes.push({ fecha, posicion, arete });
  }
  return { aretes, errores };
}

/**
 * CSV a filas. Detecta el separador (; , o tabulador) en la primera línea con datos y respeta
 * comillas dobles. Sin dependencias: los CSV de Excel en español usan «;» y coma decimal.
 * @returns {{ filas: string[][], separador: string }}
 */
function parsearCsv(texto) {
  const limpio = String(texto == null ? '' : texto).replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/).find(l => l.trim()) || '';
  const conteo = (c) => primera.split(c).length - 1;
  const sep = ['\t', ';', ','].reduce((mejor, c) => (conteo(c) > conteo(mejor) ? c : mejor), ';');
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"' && campo === '') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  // El separador decide cómo leer «97,40»: con «;» la coma solo puede ser decimal.
  return { filas, separador: sep };
}

// ── Escaneo de etiquetas de deshuese ────────────────────────────────────────

/**
 * Decodifica una etiqueta para el reporte de producción. Solo sirven las de deshuese
 * (caja master y primal), porque son las que traen la fecha del deshuese y el n.º de
 * deshuese (lote CC). La de paquete no: su fecha es la del porcionado.
 *
 * @param {string} codigo  lectura cruda del escáner
 * @param {'caja'|'primal'} [tipoElegido]  para una etiqueta «ambigua», lo que eligió el operador
 * @returns {{ ok: true, etiqueta: object } | { ok: false, motivo: string, mensaje: string, alternativas?: string[] }}
 */
function etiquetaParaReporte(codigo, tipoElegido) {
  const r = decodificar(codigo);
  let lectura = r;
  if (r.tipo === 'ambigua') {
    if (tipoElegido !== 'caja' && tipoElegido !== 'primal') {
      return {
        ok: false, motivo: 'ambigua', alternativas: ['caja', 'primal'],
        mensaje: 'Esta etiqueta puede ser una caja o un primal. Indique cuál es para registrarla.',
      };
    }
    lectura = r.alternativas.find(a => a.tipo === tipoElegido);
  }
  if (lectura.tipo === 'paquete') {
    return { ok: false, motivo: 'paquete', mensaje: 'Es una etiqueta de paquete (porcionado). En este reporte solo cuentan las cajas y primales del deshuese.' };
  }
  if (lectura.tipo !== 'caja' && lectura.tipo !== 'primal') {
    return { ok: false, motivo: 'desconocida', mensaje: lectura.errores?.[0]?.mensaje || 'No se reconoce el formato de la etiqueta' };
  }
  if (lectura.errores.length) {
    return { ok: false, motivo: 'invalida', mensaje: lectura.errores.map(e => e.mensaje).join('; ') };
  }
  const c = lectura.campos;
  if (!c.pesoKg || c.pesoKg <= 0) return { ok: false, motivo: 'invalida', mensaje: 'La etiqueta trae peso 0' };
  if (!c.loteDeshuese) return { ok: false, motivo: 'invalida', mensaje: 'La etiqueta trae lote de deshuese 0' };
  return {
    ok: true,
    etiqueta: {
      codigo_crudo: r.normalizado,
      tipo: lectura.tipo,
      articulo_codigo: c.codigoProducto,
      descripcion: c.producto,
      peso_kg: c.pesoKg,
      fecha_deshuese: c.fechaDeshuese,
      lote_cc: c.loteDeshuese,
      fecha_ambigua: Boolean(c.fechaAmbigua),
      box_codigo: c.box || null,
      sufijo: c.sufijo || null,
      decodificado: { tipo: lectura.tipo, campos: c, advertencias: lectura.advertencias },
    },
  };
}

// ── Conciliación ────────────────────────────────────────────────────────────

/**
 * Cruza por artículo lo declarado por CIISA con lo escaneado en la app.
 * @param {{articulo_codigo, descripcion, peso_kg, unidad, cajas}[]} ciisa   filas del reporte CIISA
 * @param {{articulo_codigo, descripcion, kg, cajas}[]} escaneado             etiquetas agrupadas por artículo
 * @returns {{ filas: object[], resumen: object }}
 *   estado por fila: 'cuadra' | 'diferencia' | 'solo_ciisa' (no se escaneó) | 'solo_escaneo' (CIISA no lo declara)
 */
function conciliar(ciisa = [], escaneado = [], tolerancia = TOLERANCIA_KG) {
  const mapa = new Map();
  for (const l of ciisa) {
    mapa.set(l.articulo_codigo, {
      articulo: l.articulo_codigo,
      descripcion: l.descripcion || null,
      unidad: l.unidad || 'KGS',
      kg_ciisa: redondear(l.peso_kg, 2),
      cajas_ciisa: Number(l.cajas),
      kg_escaneado: null,
      cajas_escaneado: null,
    });
  }
  for (const e of escaneado) {
    const f = mapa.get(e.articulo_codigo) || {
      articulo: e.articulo_codigo, descripcion: e.descripcion || null, unidad: 'KGS',
      kg_ciisa: null, cajas_ciisa: null,
    };
    f.kg_escaneado = redondear(e.kg, 2);
    f.cajas_escaneado = Number(e.cajas);
    if (!f.descripcion) f.descripcion = e.descripcion || null;
    mapa.set(e.articulo_codigo, f);
  }

  const hayCiisa = ciisa.length > 0;
  const hayEscaneo = escaneado.length > 0;
  const filas = [...mapa.values()].sort((a, b) => a.articulo.localeCompare(b.articulo)).map(f => {
    if (!f.descripcion && CATALOGO_POR_CODIGO[f.articulo]) f.descripcion = CATALOGO_POR_CODIGO[f.articulo].nombre;
    let estado;
    let difKg = null;
    let difCajas = null;
    if (f.kg_ciisa === null) estado = 'solo_escaneo';
    else if (f.kg_escaneado === null) estado = 'solo_ciisa';
    else {
      difKg = redondear(f.kg_escaneado - f.kg_ciisa, 2);
      difCajas = f.cajas_escaneado - f.cajas_ciisa;
      estado = Math.abs(difKg) <= tolerancia && difCajas === 0 ? 'cuadra' : 'diferencia';
    }
    if (estado === 'solo_ciisa') { difKg = redondear(-f.kg_ciisa, 2); difCajas = -f.cajas_ciisa; }
    if (estado === 'solo_escaneo') { difKg = f.kg_escaneado; difCajas = f.cajas_escaneado; }
    return { ...f, dif_kg: difKg, dif_cajas: difCajas, estado };
  });

  const totCiisa = totales(ciisa.map(l => ({ peso_kg: l.peso_kg, cajas: l.cajas })));
  const totEsc = totales(escaneado.map(e => ({ peso_kg: e.kg, cajas: e.cajas })));
  const conDiferencia = filas.filter(f => f.estado !== 'cuadra').length;
  let estado;
  if (!hayCiisa && !hayEscaneo) estado = 'sin_datos';
  else if (!hayCiisa) estado = 'falta_ciisa';
  else if (!hayEscaneo) estado = 'falta_escaneo';
  else estado = conDiferencia ? 'con_diferencias' : 'cuadrado';

  return {
    filas,
    resumen: {
      estado,
      filas_con_diferencia: hayCiisa && hayEscaneo ? conDiferencia : null,
      ciisa: hayCiisa ? totCiisa : null,
      escaneado: hayEscaneo ? totEsc : null,
      diferencia: hayCiisa && hayEscaneo
        ? { kilos: redondear(totEsc.kilos - totCiisa.kilos, 2), cajas: totEsc.cajas - totCiisa.cajas }
        : null,
    },
  };
}

module.exports = {
  LIBRAS_POR_KG,
  TOLERANCIA_KG,
  COLUMNAS_PLANTILLA,
  ErrorValidacion,
  redondear,
  loteTexto,
  esFechaIso,
  parsearFecha,
  parsearNumero,
  parsearLoteCC,
  normalizarArete,
  validarReporte,
  validarAretes,
  totales,
  reportesDesdeFilas,
  aretesDesdeFilas,
  parsearCsv,
  etiquetaParaReporte,
  conciliar,
};
