// Entrada del importador: convierte lo que suba o pegue el usuario en hojas de filas crudas
// ({ nombre, filas: [[celda, …], …] }) más textos sueltos (asunto del correo, párrafos) donde
// buscar metadatos como la fecha. Soporta:
//   .xlsx              → exceljs (mismos topes que el reporte de producción)
//   .csv / .txt        → separador detectado (tab, «;», «,»)
//   .xls               → si en realidad es HTML o texto (muchos programas exportan así) se lee;
//                        un .xls binario (Excel 97-2003) no: se pide guardarlo como .xlsx
//   .html / .htm       → tablas HTML
//   .eml               → mailparser: cuerpo HTML (o texto) y asunto
//   .msg (Outlook)     → @kenjiuno/msgreader: HTML, o el RTF comprimido con el HTML encapsulado
//   .pdf con texto     → pdf-parse (para el reporte de producción de CIISA)
// Texto pegado: si el portapapeles trae HTML (Outlook/Gmail/Excel lo ponen) se usan sus tablas;
// si no, el texto plano.

const ExcelJS = require('exceljs');
const { filasDeHoja, MAX_FILAS_HOJA, MAX_COLUMNAS_HOJA, MAX_HOJAS } = require('../reporteProduccionExcel');
const { parsearCsv } = require('../reporteProduccion');

class ErrorArchivo extends Error {}

const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  ordm: 'º', ordf: 'ª', deg: '°', iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»',
};

function decodificarEntidades(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return Object.prototype.hasOwnProperty.call(ENTIDADES, e) ? ENTIDADES[e] : m;
  });
}

const limpiarCelda = (s) => decodificarEntidades(s).replace(/[ \t\r\f\v ]+/g, ' ').replace(/ *\n */g, '\n').trim();

/**
 * Tablas de un HTML (incluidas tablas anidadas, típicas de los correos de Outlook: cada tabla
 * guarda solo sus propias filas). No es un parser HTML completo: basta para tablas de datos.
 */
function tablasDesdeHtml(html) {
  const limpio = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '');
  const tablas = [];
  const pila = [];
  const re = /<\s*(\/?)\s*(table|tr|td|th|br|p|div)\b[^>]*>|([^<]+)|<[^>]*>/gi;
  let m;
  while ((m = re.exec(limpio))) {
    const [, cierre, etiqueta, texto] = m;
    const actual = pila[pila.length - 1];
    if (texto != null) {
      if (actual && actual.celda != null) actual.celda += texto;
      continue;
    }
    const tag = (etiqueta || '').toLowerCase();
    if (tag === 'table') {
      if (!cierre) pila.push({ filas: [], fila: null, celda: null });
      else if (pila.length) {
        const t = pila.pop();
        cerrarCelda(t); cerrarFila(t);
        if (t.filas.length) tablas.push(t.filas);
      }
    } else if (!actual) {
      continue;
    } else if (tag === 'tr') {
      cerrarCelda(actual); cerrarFila(actual);
      if (!cierre) actual.fila = [];
    } else if (tag === 'td' || tag === 'th') {
      cerrarCelda(actual);
      if (!cierre) { if (!actual.fila) actual.fila = []; actual.celda = ''; }
    } else if (actual.celda != null && (tag === 'br' || (cierre && (tag === 'p' || tag === 'div')))) {
      actual.celda += '\n';
    }
  }
  // Tablas sin cerrar (HTML recortado del portapapeles).
  while (pila.length) { const t = pila.pop(); cerrarCelda(t); cerrarFila(t); if (t.filas.length) tablas.push(t.filas); }
  return tablas;
}
function cerrarCelda(t) { if (t.celda != null && t.fila) t.fila.push(limpiarCelda(t.celda)); t.celda = null; }
function cerrarFila(t) { if (t.fila && t.fila.some(c => c !== '')) t.filas.push(t.fila); t.fila = null; }

/** Texto visible de un HTML (para buscar el asunto o la fecha fuera de las tablas). */
function textoDesdeHtml(html) {
  return decodificarEntidades(String(html || '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ''));
}

/**
 * Texto plano pegado → filas. Con tabuladores (Excel, tablas copiadas) se parte por tab; si no,
 * por 2+ espacios; y si eso deja una sola columna, por cualquier espacio (correo en texto plano).
 */
function filasDesdeTexto(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/);
  const conTabs = lineas.some(l => l.includes('\t'));
  if (!conTabs && lineas.some(l => /[;,]/.test(l) && !/\s{2,}/.test(l)) && lineas.filter(l => l.includes(';')).length > 1) {
    return { filas: parsearCsv(texto).filas, comaDecimal: true };
  }
  const filas = lineas.map((l) => {
    if (conTabs) return l.split('\t').map(c => c.trim());
    const porBloques = l.trim().split(/\s{2,}/);
    return porBloques.length > 1 ? porBloques : l.trim().split(/\s+/);
  });
  return { filas, comaDecimal: false };
}

async function leerXlsx(buffer) {
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ErrorArchivo('El archivo no es un Excel .xlsx válido');
  const libro = new ExcelJS.Workbook();
  try { await libro.xlsx.load(buffer); } catch (_) {
    throw new ErrorArchivo('No se pudo leer el Excel. Ábralo y guárdelo de nuevo como .xlsx');
  }
  if (libro.worksheets.length > MAX_HOJAS) throw new ErrorArchivo(`El Excel tiene ${libro.worksheets.length} hojas; el máximo es ${MAX_HOJAS}.`);
  for (const h of libro.worksheets) {
    if (h.rowCount > MAX_FILAS_HOJA) throw new ErrorArchivo(`La hoja «${h.name}» tiene ${h.rowCount} filas; el máximo es ${MAX_FILAS_HOJA}.`);
    if (h.columnCount > MAX_COLUMNAS_HOJA) throw new ErrorArchivo(`La hoja «${h.name}» tiene ${h.columnCount} columnas; el máximo es ${MAX_COLUMNAS_HOJA}.`);
  }
  return { hojas: libro.worksheets.map(h => ({ nombre: h.name, filas: filasDeHoja(h) })), textos: [] };
}

function decodificarTexto(buffer) {
  // CSV de Excel en Windows suele venir en Windows-1252: si no es UTF-8 válido se lee como latin1.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (_) { return buffer.toString('latin1'); }
}

function desdeHtml(html, extras = []) {
  const tablas = tablasDesdeHtml(html);
  return {
    hojas: tablas.map((filas, i) => ({ nombre: `Tabla ${i + 1}`, filas })),
    textos: [...extras, ...textoDesdeHtml(html).split('\n').map(s => s.trim()).filter(Boolean)],
  };
}

function desdeTexto(texto, extras = []) {
  const { filas, comaDecimal } = filasDesdeTexto(texto);
  return { hojas: [{ nombre: 'Texto', filas, comaDecimal }], textos: [...extras] };
}

async function leerEml(buffer) {
  const { simpleParser } = require('mailparser');
  const correo = await simpleParser(buffer);
  const extras = correo.subject ? [correo.subject] : [];
  if (correo.html) return { ...desdeHtml(correo.html, extras), asunto: correo.subject || null };
  return { ...desdeTexto(correo.text || '', extras), asunto: correo.subject || null };
}

function leerMsg(buffer) {
  const MsgReader = require('@kenjiuno/msgreader').default;
  let datos;
  try {
    datos = new MsgReader(new Uint8Array(buffer)).getFileData();
  } catch (_) {
    throw new ErrorArchivo('No se pudo leer el correo .msg. Ábralo en Outlook y use «Guardar como» .msg, o pegue la tabla.');
  }
  if (!datos || datos.error) throw new ErrorArchivo('El archivo .msg no es un correo de Outlook válido');
  const asunto = datos.subject || datos.normalizedSubject || null;
  const extras = asunto ? [asunto] : [];
  let html = datos.bodyHtml || (datos.html ? Buffer.from(datos.html).toString('utf8') : null);
  if (!html && datos.compressedRtf) {
    // Outlook suele guardar el cuerpo HTML solo como RTF comprimido con el HTML «encapsulado».
    try {
      const { decompressRTF } = require('@kenjiuno/decompressrtf');
      const { deEncapsulateSync } = require('rtf-stream-parser');
      const iconv = require('iconv-lite');
      const rtf = Buffer.from(decompressRTF([...datos.compressedRtf]));
      const r = deEncapsulateSync(rtf, { decode: iconv.decode });
      if (r.mode === 'html') html = String(r.text);
      else if (!datos.body) return { ...desdeTexto(String(r.text), extras), asunto };
    } catch (_) { /* sin HTML recuperable: se intenta con el texto plano */ }
  }
  if (html) return { ...desdeHtml(html, extras), asunto };
  return { ...desdeTexto(datos.body || '', extras), asunto };
}

async function leerPdf(buffer) {
  const pdf = require('pdf-parse');
  let r;
  try { r = await pdf(buffer); } catch (_) { throw new ErrorArchivo('No se pudo leer el PDF'); }
  const texto = String(r.text || '');
  // PDF escaneado (sin capa de texto): no es un error del usuario, va por la lectura por foto (visión).
  if (texto.replace(/\s+/g, '').length < 20) throw Object.assign(new ErrorArchivo('El PDF no trae texto (parece una imagen escaneada): use «Leer por foto» para transcribirlo'), { codigo: 'sin_texto' });
  return { ...desdeTexto(texto), texto };
}

/** Extensión en minúsculas de un nombre de archivo. */
const extension = (nombre) => (String(nombre || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';

/**
 * Archivo subido → { hojas, textos, asunto? }.
 * @param {Buffer} buffer
 * @param {string} nombre  nombre original (decide el lector; el contenido se revisa igual)
 */
async function leerArchivo(buffer, nombre) {
  const ext = extension(nombre);
  switch (ext) {
    case 'xlsx': return leerXlsx(buffer);
    case 'xls': {
      if (buffer[0] === 0xd0 && buffer[1] === 0xcf) {
        throw new ErrorArchivo('Este .xls es del formato viejo de Excel (97-2003). Ábralo en Excel y guárdelo como .xlsx, o expórtelo de nuevo como .xlsx/.csv.');
      }
      if (buffer[0] === 0x50 && buffer[1] === 0x4b) return leerXlsx(buffer); // .xlsx renombrado
      const texto = decodificarTexto(buffer);
      return /<table/i.test(texto) ? desdeHtml(texto) : desdeTexto(texto);
    }
    case 'csv':
    case 'txt': {
      const texto = decodificarTexto(buffer);
      if (ext === 'csv') {
        const { filas, separador } = parsearCsv(texto);
        return { hojas: [{ nombre: 'CSV', filas, comaDecimal: separador === ';' }], textos: [] };
      }
      return desdeTexto(texto);
    }
    case 'html':
    case 'htm': return desdeHtml(decodificarTexto(buffer));
    case 'eml': return leerEml(buffer);
    case 'msg': return leerMsg(buffer);
    case 'pdf': return leerPdf(buffer);
    default: throw new ErrorArchivo(`Tipo de archivo .${ext || '?'} no soportado`);
  }
}

/** Contenido pegado: { html?, texto? } (el frontend manda lo que traiga el portapapeles). */
function leerPegado({ html, texto } = {}) {
  if (html && /<t[dh]\b/i.test(html)) {
    const r = desdeHtml(html);
    if (r.hojas.length) return r;
  }
  return desdeTexto(texto || (html ? textoDesdeHtml(html) : ''));
}

module.exports = {
  leerArchivo, leerPegado, tablasDesdeHtml, textoDesdeHtml, filasDesdeTexto, extension, ErrorArchivo,
};
