// Genera PDFs de prueba con el formato del «REPORTE DIARIO DE PRODUCCION» de CIISA.
//
// No hay un PDF real en el repo (solo la captura del correo del 05-nov-2026, ver
// D:\Claude-entregas\wagyu\notas-reunion-jc-2026-11-05\reporte-produccion-y-lotes.png), así que se
// reproduce su contenido con cada dato como un texto suelto en su posición, igual que lo imprime un
// generador de reportes: pdf-parse lo lee línea por línea y a veces pega columnas sin espacio, que
// es justo lo que el lector tiene que aguantar. Uso:
//   node scripts/generar-fixture-reporte-pdf.js   → test/fixtures/reporte-produccion-lote-0N.pdf

const fs = require('fs');
const path = require('path');

const LOTE_02 = {
  fecha: '19/10/26', numLote: '2', loteCC: '02', tipo: 'TEMPISQUE',
  lineas: [
    ['11163', 'BEEF TRIMMINGS', '27.22', 1], ['21114', 'FALDILLA FLS', '1.92', 1],
    ['21115', 'POSTA PUNTA SOLOMO DE RES CP', '3.94', 1], ['21123', 'POSTA PALETA DE RES CP', '4.04', 1],
    ['21136', 'ARRACHERA', '1.90', 1], ['21213', 'POSTA CACHO DE VUELTA', '3.68', 1],
    ['21231', 'DELMONICO', '21.42', 1], ['21427', 'OSOBUCO DE RES PIC CP', '8.36', 1],
    ['22101', 'LOMITOS DE RES CG', '6.24', 1], ['22104', 'LON DE RES CHURRASCO CP', '10.18', 1],
    ['22105', 'LOMO AGUJA DE RES CP', '13.10', 1], ['22106', 'POSTA BOLITA DE RES CG', '13.80', 1],
    ['22107', 'POSTA MANO PIEDRA DE RES CG', '6.26', 1], ['22108', 'POSTA DE CUARTO DE RES CG', '21.30', 1],
    ['22116', 'POSTA VUELTA LOMO DE RES CG', '7.82', 1], ['22117', 'POSTA SOLOMO DE RES CG', '12.88', 1],
    ['22125', 'POSTA DE ENTRANA CP', '0.94', 1], ['22133', 'POSTA DE PALETA PARA PAQUETERIA', '12.06', 1],
    ['22140', 'CESINA DE RES LIMPIA CP', '2.72', 1], ['22219', 'CACHO DE PALETA SCT DE RES CP', '4.36', 1],
    ['22224', 'CARNE DE RES QUITITENA CG', '5.66', 1], ['22228', 'POSTA DE PECHO  BRS.', '12.38', 1],
    ['22229', 'CH-CHUCK RES', '136.10', 5], ['22431', 'COSTILLA DE RES PICADA', '8.46', 1],
    ['30124', 'BEEF OXTAIL/RABO RES', '1.60', 1], ['40114', 'TUETANO CORTADO', '1.70', 1],
    ['40141', 'SERV.MAN DIAFRAGMA (OUTSIDE SKIRT)', '0.78', 1],
  ],
  pie: { libras: '773.42', kilos: '350.82', cajas: '31' },
};

// Lote 3 de la misma tanda (inventado, mismo formato): para probar varios PDFs a la vez.
const LOTE_03 = {
  fecha: '19/10/26', numLote: '3', loteCC: '03', tipo: 'TEMPISQUE',
  lineas: [['11163', 'BEEF TRIMMINGS', '20.00', 1], ['21231', 'DELMONICO', '18.50', 1], ['22229', 'CH-CHUCK RES', '120.00', 4]],
  pie: { libras: '349.43', kilos: '158.50', cajas: '6' },
};

// Cada dato es un texto suelto en su posición (como un generador de reportes). pdfkit (solo de
// desarrollo) arma un PDF válido; las coordenadas van de arriba hacia abajo.
function pdfDe(rep) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: [800, 842], margin: 0, compress: false, info: { Producer: 'fixture', CreationDate: new Date(Date.UTC(2026, 10, 5)) } });
  const partes = [];
  doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', () => ok(Buffer.concat(partes))));
  doc.font('Courier');
  const t = (x, y, s, size = 9) => doc.fontSize(size).text(s, x, 842 - y, { lineBreak: false });
  t(80, 800, 'REPORTE DIARIO DE PRODUCCION', 14);
  t(10, 775, 'Fecha de Produccion:'); t(260, 775, rep.fecha);
  t(15, 740, 'Num. Lote'); t(120, 740, rep.numLote); t(215, 740, 'Tipo Produccion:'); t(380, 740, rep.tipo);
  t(17, 728, 'Lote CC'); t(120, 728, rep.loteCC);
  t(10, 712, 'Articulo'); t(520, 712, 'Peso'); t(585, 712, 'Unidad'); t(700, 712, 'Cajas');
  let y = 700;
  for (const [cod, desc, peso, cajas] of rep.lineas) {
    t(10, y, cod); t(75, y, desc); t(530, y, peso); t(600, y, 'KGS'); t(705, y, String(cajas));
    y -= 12;
  }
  y -= 30;
  t(10, y, 'Total de Cajas por el Lote #'); t(245, y, rep.numLote); t(305, y, 'Libras'); t(375, y, rep.pie.libras);
  t(485, y, 'Kilos'); t(600, y, rep.pie.kilos); t(700, y, rep.pie.cajas);
  doc.end();
  return fin;
}

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'test', 'fixtures');
  (async () => {
    fs.writeFileSync(path.join(dir, 'reporte-produccion-lote-02.pdf'), await pdfDe(LOTE_02));
    fs.writeFileSync(path.join(dir, 'reporte-produccion-lote-03.pdf'), await pdfDe(LOTE_03));
    console.log('PDFs de prueba escritos en', dir);
  })();
}

module.exports = { pdfDe, LOTE_02, LOTE_03 };
