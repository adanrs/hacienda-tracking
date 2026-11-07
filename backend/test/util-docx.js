// Arma un .docx mínimo en memoria para las pruebas (sin Word): el paquete con [Content_Types].xml,
// las relaciones y word/document.xml con párrafos y tablas. Word lo abre igual.
const JSZip = require('jszip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const parrafo = (t) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
const celda = (t) => `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr>${String(t).split('\n').map(parrafo).join('')}</w:tc>`;
const tabla = (filas) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="1200"/></w:tblGrid>${filas.map((f) => `<w:tr><w:trPr/>${f.map(celda).join('')}</w:tr>`).join('')}</w:tbl>`;

/**
 * @param {Array<string|string[][]>} bloques  texto = párrafo; arreglo de filas = tabla
 * @returns {Promise<Buffer>}
 */
async function crearDocx(bloques) {
  const cuerpo = bloques.map((b) => (Array.isArray(b) ? tabla(b) : parrafo(b))).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { crearDocx };
