// Utilidades puras del importador masivo: normalizar encabezados y llaves, leer números y fechas
// tal como vienen de Excel, CSV o un correo pegado. No tocan la base: se prueban sin MySQL.

/** Texto de encabezado comparable: minúsculas, sin tildes, sin puntuación ni espacios repetidos. */
function normalizarEncabezado(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[#º°]/g, ' n ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Número del animal (arete) o de madre/padre: mayúsculas, sin espacios a los lados y con los
 * internos colapsados. NO se quitan guiones ni espacios internos («KUNE 1029G», «438-HF»):
 * son parte del código en Ganadero SG. El apóstrofo inicial lo agrega Excel a textos que
 * parecen números.
 */
function normalizarArete(v) {
  if (v == null) return '';
  return String(v).trim().replace(/^'/, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Identificación electrónica (chip): solo letras y dígitos, en mayúsculas. */
function normalizarIE(v) {
  if (v == null) return '';
  return String(v).replace(/^'/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Número desde Excel/CSV/correo. Acepta «1,984.25», «1.984,25», «378,5», «60.27 %».
 * Con un solo separador se decide así: si hay coma y punto, el último es el decimal; si solo
 * hay coma, es decimal salvo que tenga exactamente 3 dígitos detrás y el número sea entero
 * grande («1,984» = 1984); `comaDecimal` fuerza la coma como decimal (CSV con «;»).
 * Devuelve null si está vacío y NaN si no se puede leer.
 */
function parsearNumero(v, { comaDecimal = false } = {}) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/\s|%|kg$/gi, '');
  if (s === '' || s === '-') return null;
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (tieneComa) {
    const miles = !comaDecimal && /^-?\d{1,3}(,\d{3})+$/.test(s);
    s = miles ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (a, m, d) => `${a}-${pad(m)}-${pad(d)}`;

function fechaValida(a, m, d) {
  if (!(a >= 1900 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Serial de Excel (días desde 1899-12-30) → AAAA-MM-DD. */
function fechaDesdeSerialExcel(n) {
  if (!(n > 20000 && n < 80000)) return null; // 1954..2119: fuera de eso no es una fecha de este reporte
  const f = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
}

/** Separa «3/14/2024», «15-10-26», «2024-03-14» en partes numéricas (o null). */
function partesFecha(texto) {
  const s = String(texto).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?\s*m\.?)?$/i, '');
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return { tipo: 'ymd', a: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let a = +m[3];
    if (m[3].length === 2) a += 2000; // reportes de 2000 en adelante; un nacimiento «99» no aplica aquí
    return { tipo: 'xy', x: +m[1], y: +m[2], a };
  }
  return null;
}

/**
 * Orden de las fechas de texto de UNA columna: si algún valor tiene el primer número > 12 es
 * día/mes; si alguno tiene el segundo > 12 es mes/día; si ninguno decide, se usa el del formato.
 * Así «3/14/2024» y «10/15/2026» fijan m/d para toda la columna aunque «2/9/2024» sea ambigua.
 */
function ordenFechaColumna(valores, preferido = 'dmy') {
  let dmy = false;
  let mdy = false;
  for (const v of valores) {
    if (v == null || v instanceof Date || typeof v === 'number') continue;
    const p = partesFecha(v);
    if (!p || p.tipo !== 'xy') continue;
    if (p.x > 12) dmy = true;
    if (p.y > 12) mdy = true;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return preferido; // ambas (columna mezclada: se marcará error en las filas que no cuadren) o ninguna
}

/**
 * Fecha → AAAA-MM-DD. Acepta Date (exceljs entrega la fecha en UTC a medianoche), serial de
 * Excel, AAAA-MM-DD y d/m/a o m/d/a según `orden`. Devuelve null si viene vacía y
 * { error } si no se puede leer.
 */
function parsearFecha(v, orden = 'dmy') {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { error: 'fecha inválida' };
    return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'number') return fechaDesdeSerialExcel(v) || { error: `«${v}» no es una fecha` };
  const s = String(v).trim();
  if (s === '' || s === '-') return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return fechaDesdeSerialExcel(Number(s)) || { error: `«${s}» no es una fecha` };
  const p = partesFecha(s);
  if (!p) return { error: `«${s}» no es una fecha` };
  let a; let m; let d;
  if (p.tipo === 'ymd') ({ a, m, d } = p);
  else if (orden === 'mdy') { a = p.a; m = p.x; d = p.y; } else { a = p.a; d = p.x; m = p.y; }
  if (!fechaValida(a, m, d)) return { error: `«${s}» no es una fecha válida (${orden === 'mdy' ? 'mes/día/año' : 'día/mes/año'})` };
  return iso(a, m, d);
}

/** Distancia de edición (Levenshtein) entre dos textos cortos, con tope para cortar temprano. */
function distanciaEdicion(a, b, tope = Infinity) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + costo);
      if (actual[j] < minFila) minFila = actual[j];
    }
    if (minFila > tope) return tope + 1;
    previa = actual;
  }
  return previa[b.length];
}

const vacio = (v) => v == null || (typeof v === 'string' && v.trim() === '');

module.exports = {
  normalizarEncabezado, normalizarArete, normalizarIE, parsearNumero, parsearFecha,
  ordenFechaColumna, fechaDesdeSerialExcel, distanciaEdicion, vacio,
};
