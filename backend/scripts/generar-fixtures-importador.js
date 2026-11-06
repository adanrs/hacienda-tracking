// Genera los archivos de prueba del importador (se versionan; este script queda para regenerarlos):
//   node scripts/generar-fixtures-importador.js
//
//   ganadero-sg-salidas.xlsx         → imita la captura del reporte de Software GANADERO SG
//                                      (títulos, leyenda, «Actualizado a», encabezado en la fila 10
//                                      con autofiltro, las 5 filas de la imagen + casos raros)
//   sacrificio-wagyu-15-10-26.eml    → correo de CIISA con la tabla HTML (incluye 177NFU, mal escrito)
//   sacrificio-wagyu-15-10-26.msg    → el mismo correo como .msg de Outlook (CFB), mínimo
//   sacrificio-pegado-excel.txt      → la misma tabla copiada de Excel (con tabs)
//   sacrificio-pegado-gmail.txt      → la tabla copiada como texto plano de Gmail (espacios)
//   marmoleo-camara-pegado.txt       → tabla de la cámara de canales pegada (tabs, columnas extra)

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const DIR = path.join(__dirname, '..', 'test', 'fixtures');
const d = (a, m, dia) => new Date(Date.UTC(a, m - 1, dia)); // exceljs guarda la fecha en UTC

// Las 5 filas de la captura (F. Nto y FUV como fechas reales de Excel, como exporta Ganadero SG).
const FILAS_CAPTURA = [
  ['225MLE', 'M', 31.1, d(2024, 3, 14), 'WAG/50-BRA/50', '225LEZ', 'PG89', 'PDR', 'A0020000188000001057859', 274, 660, 671.96, d(2026, 3, 16), 'CLOSTRIDIOS', d(2026, 10, 15), 'FINALIZADO', 'V', 9, 660, 'EQTBL RECIPROC'],
  ['33FLE', 'H', 32.1, d(2024, 2, 12), 'WAG/50-BRA/50', '33LET', 'KUNE 1029G', 'PDR', 'A0020000188000001057868', 274, 714, 705.94, d(2026, 3, 16), 'CLOSTRIDIOS', d(2026, 10, 15), 'FINALIZADO', 'V', 11, 714, 'EQTBL RECIPROC'],
  ['438MLF', 'M', 31.1, d(2024, 3, 12), 'WAG/50-BRA/50', '438-HF', 'PG89', 'PDR', 'A0020000188000001057892', 274, 766, 781.41, d(2026, 3, 16), 'CLOSTRIDIOS', d(2026, 10, 15), 'FINALIZADO', 'V', 10, 766, 'EQTBL RECIPROC'],
  ['710FLF', 'H', 32.2, d(2024, 2, 9), 'WAG/50-BRA/50', '710-HF', 'KUNE 1029G', 'PDR', 'A0020000188000001057759', 338, 618, 605.72, d(2026, 3, 16), 'CLOSTRIDIOS', d(2026, 10, 15), 'FINALIZADO', 'V', 10, 618, 'EQTBL RECIPROC'],
  ['81FLB', 'M', 32.2, d(2024, 2, 10), 'WAG/50-BRA/37-CEB/12', '81-JB', '200KB0308', 'PDR', 'A0020000188000001057871', 274, 748, 739.26, d(2026, 3, 16), 'CLOSTRIDIOS', d(2026, 10, 15), 'FINALIZADO', 'V', 9, 748, 'EQTBL RECIPROC'],
];

// Casos raros: fechas como texto m/d/aaaa, I.E. con espacios, números con coma, errores.
const FILAS_RARAS = [
  // 6: animal que la planta escribirá mal (177NFU); fechas en texto, I.E. con espacios, peso con coma decimal
  [' 177mfu ', 'M', '31,5', '3/1/2024', 'WAG/50-BRA/50', '177LEZ', 'PG89', 'PDR', 'A002 0000 1880 0000 1057900', 274, '760,0', '701.3', '3/16/2026', 'CLOSTRIDIOS', '10/15/2026', 'FINALIZADO', 'V', 8, '760', 'EQTBL RECIPROC'],
  // 7: número vacío (error)
  ['', 'M', 30, d(2024, 4, 1), 'WAG/50-BRA/50', '1LEZ', 'PG89', 'PDR', '', 274, 650, 640, null, null, null, null, null, null, null, null],
  // 8: fecha de nacimiento imposible (error)
  ['900XYZ', 'H', 30, '31/31/2024', 'WAG/50-BRA/50', '2LEZ', 'PG89', 'PDR', 'A0020000188000001057999', 274, 600, 620, null, null, null, null, null, null, null, null],
  // 9: peso de salida fuera de rango (error)
  ['901XYZ', 'M', 30, d(2024, 4, 2), 'WAG/50-BRA/50', '3LEZ', 'PG89', 'PDR', 'A0020000188000001058001', 274, 700, 690, d(2026, 3, 16), 'CLOSTRIDIOS', d(2026, 10, 15), 'FINALIZADO', 'V', 1, 7000, 'EQTBL RECIPROC'],
  // 10: raza desconocida (aviso), sin salida: queda en el hato con su U.Peso; potrero nuevo
  ['902XYZ', 'H', 20, d(2025, 2, 1), 'WAG/50-XYZ/50', '4LEZ', 'PG89', 'P-NUEVO', 'A0020000188000001058002', 30, 420, 690, null, null, null, null, null, null, null, null],
  // 11: número repetido (error)
  ['225MLE', 'M', 31.1, d(2024, 3, 14), 'WAG/50-BRA/50', '225LEZ', 'PG89', 'PDR', '', 274, 660, 671.96, null, null, null, null, null, null, null, null],
];

const ENCABEZADO = ['Número', 'Sexo', 'E.Mes', 'F. Nto', 'Raza', '# Madre', '# Padre', 'Pot.', 'I.E.', 'Días pot', 'U.Peso', 'gr/día/vida', 'FUV', 'UV', 'Fec. salida', 'Causa salida', 'Tipo Dest', 'Obs. salida', 'Peso sal.', 'Vendido a'];

async function xlsxGanaderoSg() {
  const libro = new ExcelJS.Workbook();
  const h = libro.addWorksheet('Reporte');
  h.getCell('H1').value = 'Sistematización de Hatos';
  h.getCell('H2').value = 'Software GANADERO SG - Reportes Personalizados';
  h.getCell('H3').value = '01-003 - ENGORDE  WAGYU';
  h.getCell('E5').value = 'Número = Número del Animal';
  h.getCell('H5').value = 'Sexo = Sexo';
  h.getCell('J5').value = 'E.Mes = Edad en meses';
  h.getCell('M5').value = 'F. Nto = Fecha nacimiento';
  h.getCell('P5').value = 'Raza = Raza';
  h.getCell('E6').value = '# Madre = Nro. Madre';
  h.getCell('H6').value = '# Padre = Nro. Padre';
  h.getCell('J6').value = 'Pot. = Potrero';
  h.getCell('M6').value = 'I.E. = Identificación electrónica';
  h.getCell('P6').value = 'Días pot. = Días en potrero';
  h.getCell('D7').value = 'Causa salida = Causa salida';
  h.getCell('H7').value = 'Tipo Dest = Tipo destino';
  h.getCell('J7').value = 'Obs. salida = Observaciones salida';
  h.getCell('M7').value = 'Peso sal. = Peso a la salida';
  h.getCell('P7').value = 'Vendido a = Vendido a';
  h.getCell('A8').value = 'Actualizado a: 15/10/26';
  h.getCell('D8').value = 'Impresión: 21/10/26 10:28:38 AM';
  h.getRow(10).values = ENCABEZADO;
  h.getRow(10).font = { bold: true };
  [...FILAS_CAPTURA, ...FILAS_RARAS].forEach((f, i) => { h.getRow(11 + i).values = f; });
  h.getRow(11 + FILAS_CAPTURA.length + FILAS_RARAS.length + 1).values = ['Total animales: 11'];
  h.autoFilter = { from: 'A10', to: 'T10' };
  for (const col of ['D', 'M', 'O']) h.getColumn(col).numFmt = 'm/d/yyyy';
  await libro.xlsx.writeFile(path.join(DIR, 'ganadero-sg-salidas.xlsx'));
}

// Correo de CIISA: tabla de la captura (5259 trae 177NFU, que no está en la guía: es 177MFU).
const SACRIFICIO = [
  [1, 5256, 'M', 628, 378.5, 60.27, '225MLE', 1, 4, 3, '-'],
  [2, 5257, 'M', 740, 460, 62.16, '438MLF', 1, 4, 3, '-'],
  [3, 5258, 'M', 710, 420, 59.15, '81FLB', 1, 4, 3, '-'],
  [4, 5259, 'M', 732, 439, 59.97, '177NFU', 2, 8, 2, '-'],
  [5, 5260, 'H', 690, 416.5, 60.36, '33FLE', 1, 6, 3, '-'],
  [6, 5261, 'H', 592, 341.5, 57.69, '710FLF', 1, 4, 3, '-'],
];

function htmlSacrificio() {
  const th = ['Cantidad', 'Número<br>de<br>canal', 'Sexo', 'Peso<br>pie<br>(kg)', 'Peso<br>canal<br>(kg)', 'Rendimiento<br>%', 'Arete', 'Musculo', 'Dientes', 'Grasa', 'Golpe'];
  const filas = SACRIFICIO.map(f => `<tr>${f.map(c => `<td align="center"><b>${c}</b></td>`).join('')}</tr>`).join('\n');
  // Tabla de datos anidada dentro de una tabla de diseño, como la arma Outlook.
  return `<html><head><style>td{font-family:Times}</style></head><body>
<p style="color:#4472c4">Buenos d&iacute;as Don Juan lo del sacrificio Wagyu .</p>
<p><b>Asunto:</b> Sacrificio Wagyu 15-10-26</p>
<table><tr><td>
<table border="1" cellspacing="0">
<tr>${th.map(t => `<th>${t}</th>`).join('')}</tr>
${filas}
</table>
</td></tr></table>
</body></html>`;
}

function eml() {
  const html = htmlSacrificio();
  const b64 = Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    'From: Gerardo Araya Calvo <gerardo@example.com>',
    'To: JCGILLEN@gmail.com',
    'Subject: =?UTF-8?Q?RV:_Sacrificio_Wagyu_15-10-26?=',
    'Date: Sat, 17 Oct 2026 08:10:00 -0600',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="LIMITE"',
    '',
    '--LIMITE',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Buenos dias Don Juan lo del sacrificio Wagyu.',
    '--LIMITE',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '--LIMITE--',
    '',
  ].join('\r\n');
}

/**
 * .msg mínimo (Compound File Binary): asunto (PidTagSubject, UTF-16) y cuerpo HTML
 * (PidTagHtml, binario) más el flujo de propiedades que exige el formato.
 */
function msg() {
  const CFB = require('cfb');
  const cfb = CFB.utils.cfb_new();
  const asunto = Buffer.from('RV: Sacrificio Wagyu 15-10-26', 'utf16le');
  const html = Buffer.from(htmlSacrificio(), 'utf8');
  // __properties_version1.0 del mensaje raíz: 32 bytes de encabezado + 16 por propiedad.
  const props = Buffer.alloc(32 + 16 * 2);
  const prop = (i, tag, tam) => {
    const o = 32 + i * 16;
    props.writeUInt32LE(tag, o);
    props.writeUInt32LE(0x6, o + 4); // legible y escribible
    props.writeUInt32LE(tam, o + 8);
  };
  prop(0, 0x0037001f, asunto.length + 2);
  prop(1, 0x10130102, html.length);
  CFB.utils.cfb_add(cfb, '/__properties_version1.0', props);
  CFB.utils.cfb_add(cfb, '/__substg1.0_0037001F', asunto);
  CFB.utils.cfb_add(cfb, '/__substg1.0_10130102', html);
  CFB.utils.cfb_add(cfb, '/__substg1.0_001A001F', Buffer.from('IPM.Note', 'utf16le'));
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}

function pegadoExcel() {
  const enc = ['Cantidad', 'Número de canal', 'Sexo', 'Peso pie (kg)', 'Peso canal (kg)', 'Rendimiento %', 'Arete', 'Musculo', 'Dientes', 'Grasa', 'Golpe'];
  return [enc, ...SACRIFICIO].map(f => f.join('\t')).join('\r\n');
}

function pegadoGmail() {
  // Gmail en texto plano parte el encabezado de varias líneas: solo las filas de datos sirven.
  return ['Asunto: Sacrificio Wagyu 15-10-26', '', 'Cantidad', 'Número', 'de', 'canal', 'Sexo', 'Peso', 'pie', '(kg)',
    ...SACRIFICIO.map(f => f.join(' '))].join('\n');
}

// Medición de marmoleo de la cámara (7 filas del 20/08/2026). La última columna «DMf» es la que
// aparece cortada en la captura y «Operador» una columna extra que no conoce el importador.
const MARMOLEO = [
  ['2026-08-20 03:37:54', '5111 17DKF', 21.71, 7.38, '101.00', 6.41, 4, 620, 4, 2],
  ['2026-08-20 03:35:41', '5110 13NKA', 22.92, 6.55, 84.21, 6.76, 5, 690, 3, 2],
  ['2026-08-20 03:33:12', '5109 302MLF', 23.28, 6.60, 102.48, 6.87, 5, 700, 3, 3],
  ['2026-08-20 03:31:05', '5108 185NKZ', 21.02, 5.14, 103.88, 6.20, 4, 660, 3, 1],
  ['2026-08-20 03:29:30', '5107 31DKA', 24.94, 5.60, 75.36, 7.36, 5, 770, 3, 2],
  ['2026-08-20 03:27:18', '5106 176FLE', 13.07, 4.41, 92.25, 3.86, 2, 430, 3, 3],
  ['2026-08-20 03:25:02', '5105 11ELE', 24.37, 5.17, 110.56, 7.19, 5, 730, 3, 2],
];
const ENC_MARMOLEO = ['Taken at', 'Barcode no.', 'Body no.', 'DMp (%)', 'NFI-2', 'DMa (cm2)', 'DMs', 'DMs (AUSMEAT)', 'DMs (MSA)', 'DMc', 'DMf', 'Operador'];
const filasMarmoleo = () => MARMOLEO.map(([t, body, ...r]) => [t, body, body, ...r, 'cam-1']);

function marmoleoTexto() {
  return [ENC_MARMOLEO, ...filasMarmoleo()].map(f => f.join('\t')).join('\n');
}

function marmoleoHtml() {
  return `<table class="grid"><thead><tr>${ENC_MARMOLEO.map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody>
${filasMarmoleo().map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('\n')}
</tbody></table>`;
}

async function main() {
  await xlsxGanaderoSg();
  fs.writeFileSync(path.join(DIR, 'sacrificio-wagyu-15-10-26.eml'), eml());
  fs.writeFileSync(path.join(DIR, 'sacrificio-wagyu-15-10-26.msg'), msg());
  fs.writeFileSync(path.join(DIR, 'sacrificio-pegado-excel.txt'), pegadoExcel());
  fs.writeFileSync(path.join(DIR, 'sacrificio-pegado-gmail.txt'), pegadoGmail());
  fs.writeFileSync(path.join(DIR, 'marmoleo-camara-pegado.txt'), marmoleoTexto());
  console.log('Fixtures generados en', DIR);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { SACRIFICIO, htmlSacrificio, FILAS_CAPTURA, MARMOLEO, marmoleoTexto, marmoleoHtml };
