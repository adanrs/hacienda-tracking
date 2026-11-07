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
//   .docx (Word)       → jszip lee word/document.xml: cada tabla de Word es una hoja y los párrafos
//                        quedan como textos sueltos (y como texto corrido, para los documentos).
//                        Un .doc viejo (Word 97-2003) no: se pide guardarlo como .docx o subir PDF/foto.
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
// Tope del HTML que se analiza. Un correo con la tabla de sacrificio pesa unos KB; más que esto
// es un archivo armado para gastar CPU.
const MAX_HTML = 500 * 1024;

/**
 * Quita comentarios y bloques <script>/<style>/<head> con indexOf (lineal). Las regex perezosas
 * equivalentes (/<!--[\s\S]*?-->/) son cuadráticas con muchos «<!--» sin cerrar.
 */
function quitarBloques(html) {
  const bajo = html.toLowerCase();
  let salida = '';
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { salida += html.slice(i); break; }
    salida += html.slice(i, lt);
    let cierre = null;
    if (bajo.startsWith('<!--', lt)) cierre = '-->';
    else {
      const m = /^<(script|style|head)\b/.exec(bajo.slice(lt, lt + 8));
      if (m) cierre = `</${m[1]}`;
    }
    if (!cierre) { salida += '<'; i = lt + 1; continue; }
    const fin = bajo.indexOf(cierre, lt + 1);
    if (fin < 0) break; // bloque sin cerrar: lo que sigue no es contenido visible
    if (cierre === '-->') { i = fin + 3; continue; }
    const gt = bajo.indexOf('>', fin);
    i = gt < 0 ? html.length : gt + 1;
  }
  return salida;
}

function htmlAcotado(html) {
  const s = String(html || '');
  if (s.length > MAX_HTML) throw new ErrorArchivo('El contenido HTML es demasiado grande (más de 500 KB): pegue solo la tabla');
  return s;
}

function tablasDesdeHtml(html) {
  const limpio = quitarBloques(htmlAcotado(html));
  const tablas = [];
  const pila = [];
  let filasTotales = 0;
  // `[^<>]*` no cruza otro «<»: con miles de «<» sin cerrar cada intento corta en el siguiente
  // (lineal); `[^>]*` recorría hasta el final cada vez (cuadrático). Un «<» suelto es texto.
  const re = /<\s*(\/?)\s*(table|tr|td|th|br|p|div)\b[^<>]*>|<[^<>]*>|([^<]+|<)/gi;
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
      if (!cierre) {
        actual.fila = [];
        if (++filasTotales > MAX_FILAS_HOJA) throw new ErrorArchivo(`La tabla tiene más de ${MAX_FILAS_HOJA} filas`);
      }
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
  return decodificarEntidades(quitarBloques(htmlAcotado(html))
    .replace(/<br\s*\/?>|<\/(p|div|tr|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^<>]*>/g, ''));
}

/**
 * Texto plano pegado → filas. Con tabuladores (Excel, tablas copiadas) se parte por tab; si no,
 * por 2+ espacios; y si eso deja una sola columna, por cualquier espacio (correo en texto plano).
 */
function filasDesdeTexto(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/);
  // Mismo tope que una hoja de Excel: un pegado o CSV con más filas es un error (o un abuso).
  if (lineas.length > MAX_FILAS_HOJA) throw new ErrorArchivo(`El texto tiene ${lineas.length} líneas; el máximo es ${MAX_FILAS_HOJA}`);
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
  // Outlook suele guardar el cuerpo HTML solo como RTF comprimido con el HTML «encapsulado».
  // decompressRTF reserva el tamaño que declara el encabezado sin validarlo: un .msg armado con un
  // RawSize enorme tumba el proceso (sin excepción atrapable). Si el encabezado no es coherente o
  // promete más de 5 MB, el RTF se ignora y se sigue con el texto plano.
  if (!html && datos.compressedRtf && rtfComprimidoSeguro(datos.compressedRtf)) {
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
  // El pdf.js por omisión de pdf-parse (1.10) falla con algunos PDF válidos («bad XRef entry», p. ej.
  // los de pocas páginas sin texto de un escáner): se reintenta con el pdf.js 2.0 que trae el paquete.
  try { r = await pdf(buffer); } catch (_) {
    try { r = await pdf(buffer, { version: 'v2.0.550' }); } catch (__) { throw new ErrorArchivo('No se pudo leer el PDF'); }
  }
  const texto = String(r.text || '');
  // PDF escaneado (sin capa de texto): no es un error del usuario, va por la lectura por foto (visión).
  if (texto.replace(/\s+/g, '').length < 20) throw Object.assign(new ErrorArchivo('El PDF no trae texto (parece una imagen escaneada): use «Leer por foto» para transcribirlo'), { codigo: 'sin_texto' });
  return { ...desdeTexto(texto), texto };
}

// ── Word (.docx) ─────────────────────────────────────────────────────────────
// Por qué jszip y no mammoth: el .docx es un zip con el documento en word/document.xml; lo único que
// se necesita son las tablas y los párrafos, sin formato. jszip ya viene con exceljs (sin binarios
// nativos) y leer el XML directo evita convertir a HTML y volver a leerlo.
const MENSAJE_DOC = 'Este .doc es del formato viejo de Word (97-2003): ábralo en Word y guárdelo como .docx, o súbalo como PDF o foto.';
// El document.xml de un Word de varias páginas pesa unos cientos de KB; 10 MB descomprimido ya es
// un archivo armado para gastar memoria (zip bomb).
const MAX_DOCX_XML = 10 * 1024 * 1024;

/**
 * XML de Word → { hojas, textos, texto }. No es un parser XML completo: recorre en orden las
 * etiquetas que importan (w:tbl, w:tr, w:tc, w:p, w:t, w:tab, w:br). Una tabla dentro de otra (Word
 * la usa para maquetar) se aplana dentro de la celda que la contiene.
 *   hojas  → una por tabla de Word (filas de celdas), como las tablas de un correo HTML.
 *   textos → los párrafos fuera de tablas (título, número, fecha del documento).
 *   texto  → todo en orden de lectura; las filas de tabla, con las celdas por tabulador. Es lo que
 *            reciben los formatos de «documentos» (guía del MAG, documentos de custodia).
 */
function desdeDocxXml(xml) {
  const hojas = [];
  const lineas = [];
  const textos = [];
  const pila = [];
  let parrafo = '';
  let filasTotales = 0;
  const actual = () => pila[pila.length - 1];
  const agregar = (t) => {
    const tb = actual();
    if (tb && tb.celda != null) tb.celda += t; else parrafo += t;
  };
  // `[^<>]*` no cruza otra etiqueta: lineal aunque el XML venga roto.
  const re = /<w:t(?:\s[^<>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^<>]*\/>|<(\/?)w:(tbl|tr|tc|p)\b([^<>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, texto, salto, cierre, etiqueta, , vacia] = m;
    if (texto != null) { agregar(decodificarEntidades(texto)); continue; }
    if (salto) { agregar(salto === 'tab' ? '\t' : '\n'); continue; }
    const tb = actual();
    if (etiqueta === 'p') {
      if (!cierre && !vacia) continue;
      if (tb && tb.celda != null) {
        if (tb.celda && !tb.celda.endsWith('\n')) tb.celda += '\n';
      } else {
        for (const l of parrafo.split('\n').map(x => x.replace(/[  ]+/g, ' ').trim()).filter(Boolean)) { lineas.push(l); textos.push(l); }
        parrafo = '';
      }
    } else if (etiqueta === 'tbl') {
      if (!cierre) { pila.push({ filas: [], fila: null, celda: null }); continue; }
      const t = pila.pop();
      if (!t) continue;
      cerrarCelda(t); cerrarFila(t);
      const padre = actual();
      if (padre && padre.celda != null) padre.celda += t.filas.map(f => f.join(' ')).join('\n');
      else if (t.filas.length) {
        hojas.push({ nombre: `Tabla ${hojas.length + 1}`, filas: t.filas });
        for (const f of t.filas) lineas.push(f.map(c => c.replace(/\s*\n\s*/g, ' ')).join('\t'));
      }
    } else if (!tb) {
      continue;
    } else if (etiqueta === 'tr') {
      cerrarCelda(tb); cerrarFila(tb);
      if (!cierre) {
        tb.fila = [];
        if (++filasTotales > MAX_FILAS_HOJA) throw new ErrorArchivo(`El documento tiene más de ${MAX_FILAS_HOJA} filas de tabla`);
      }
    } else if (etiqueta === 'tc') {
      cerrarCelda(tb);
      if (!cierre) { if (!tb.fila) tb.fila = []; tb.celda = ''; }
    }
  }
  for (const l of parrafo.split('\n').map(x => x.trim()).filter(Boolean)) { lineas.push(l); textos.push(l); }
  const texto = lineas.join('\n');
  // Sin tablas (alguien pegó el reporte como texto en Word): las líneas se parten como un pegado.
  if (!hojas.length && texto) {
    const { filas, comaDecimal } = filasDesdeTexto(texto);
    hojas.push({ nombre: 'Texto', filas, comaDecimal });
  }
  return { hojas, textos, texto };
}

async function leerDocx(buffer) {
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf) throw new ErrorArchivo(MENSAJE_DOC); // .doc renombrado
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ErrorArchivo('El archivo no es un Word .docx válido');
  const JSZip = require('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch (_) {
    throw new ErrorArchivo('No se pudo leer el Word. Ábralo y guárdelo de nuevo como .docx, o súbalo como PDF.');
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new ErrorArchivo('El archivo no es un documento de Word (.docx) válido');
  // El tamaño que declara el zip se revisa ANTES de descomprimir (y el real, después).
  const declarado = doc._data && Number(doc._data.uncompressedSize);
  const MUY_GRANDE = 'El documento de Word es demasiado grande: guarde solo las páginas que necesita';
  if (declarado > MAX_DOCX_XML) throw new ErrorArchivo(MUY_GRANDE);
  // El encabezado del zip puede mentir: se descomprime por partes y se corta al pasar el tope, así
  // un .docx armado (5 MB que se inflan a GB) no se come la memoria del servidor.
  const xml = await new Promise((ok, mal) => {
    const partes = [];
    let total = 0;
    const flujo = doc.internalStream('uint8array');
    flujo.on('data', (parte) => {
      total += parte.length;
      if (total > MAX_DOCX_XML) { flujo.pause(); mal(new ErrorArchivo(MUY_GRANDE)); return; }
      partes.push(Buffer.from(parte));
    }).on('error', () => mal(new ErrorArchivo('No se pudo leer el Word. Ábralo y guárdelo de nuevo como .docx, o súbalo como PDF.')))
      .on('end', () => ok(Buffer.concat(partes).toString('utf8')))
      .resume();
  });
  const r = desdeDocxXml(xml);
  if (!r.texto.trim()) throw new ErrorArchivo('El Word no trae texto (¿es una foto pegada?): use «Cargar por foto»');
  return r;
}

const MAX_RTF = 5 * 1024 * 1024;
/** Encabezado del RTF comprimido: CompSize (bytes tras ese campo) y RawSize (descomprimido). */
function rtfComprimidoSeguro(rtf) {
  if (!rtf || rtf.length < 16) return false;
  const b = Buffer.from(rtf.buffer ? new Uint8Array(rtf.buffer, rtf.byteOffset, rtf.byteLength) : rtf);
  const compSize = b.readInt32LE(0);
  const rawSize = b.readInt32LE(4);
  return compSize >= 12 && compSize + 4 <= b.length && rawSize >= 0 && rawSize <= MAX_RTF;
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
        if (texto.split('\n').length > MAX_FILAS_HOJA) throw new ErrorArchivo(`El archivo tiene más de ${MAX_FILAS_HOJA} filas`);
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
    case 'docx': return leerDocx(buffer);
    case 'doc': throw new ErrorArchivo(MENSAJE_DOC);
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
  rtfComprimidoSeguro, MAX_HTML, desdeDocxXml, MENSAJE_DOC,
};
