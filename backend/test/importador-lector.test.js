// Lector genérico del importador (sin base de datos): encabezado con títulos encima, nombres
// truncados, fechas m/d y d/m, números con coma o punto, y las entradas de correo (.eml, .msg,
// HTML pegado, texto de Excel y de Gmail).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const t = require('../src/lib/importador/texto');
const { leerTabla, leerHojas, coincide } = require('../src/lib/importador/tabla');
const { leerArchivo, leerPegado, tablasDesdeHtml } = require('../src/lib/importador/archivos');
const { formato } = require('../src/lib/importador/formatos');
const { revisarRaza } = require('../src/lib/importador/procesadores/ganaderoSg');
const { htmlSacrificio } = require('../scripts/generar-fixtures-importador');

const FIX = path.join(__dirname, 'fixtures');
const SG = formato('ganadero-sg');
const SAC = formato('sacrificio-ciisa');

test('números: coma o punto decimal, miles, vacíos', () => {
  assert.equal(t.parsearNumero('378,5'), 378.5);
  assert.equal(t.parsearNumero('1,984.25'), 1984.25);
  assert.equal(t.parsearNumero('1.984,25'), 1984.25);
  assert.equal(t.parsearNumero('1,984'), 1984);
  assert.equal(t.parsearNumero('1,984', { comaDecimal: true }), 1.984);
  assert.equal(t.parsearNumero('60.27 %'), 60.27);
  assert.equal(t.parsearNumero('-'), null);
  assert.equal(t.parsearNumero(''), null);
  assert.ok(Number.isNaN(t.parsearNumero('abc')));
});

test('fechas: Date de Excel, serial, m/d/aaaa, d/m/aa y errores', () => {
  assert.equal(t.parsearFecha(new Date(Date.UTC(2024, 2, 14))), '2024-03-14');
  assert.equal(t.parsearFecha(45365), '2024-03-14'); // serial de Excel
  assert.equal(t.parsearFecha('3/14/2024', 'mdy'), '2024-03-14');
  assert.equal(t.parsearFecha('15/10/26', 'dmy'), '2026-10-15');
  assert.equal(t.parsearFecha('15-10-26', 'dmy'), '2026-10-15');
  assert.equal(t.parsearFecha('2026-10-15'), '2026-10-15');
  assert.ok(t.parsearFecha('3/14/2024', 'dmy').error); // mes 14 no existe
  assert.ok(t.parsearFecha('31/31/2024', 'dmy').error);
  assert.ok(t.parsearFecha('2/30/2024', 'mdy').error);
  assert.equal(t.parsearFecha(''), null);
});

test('orden de fecha por columna: un día > 12 decide para toda la columna', () => {
  assert.equal(t.ordenFechaColumna(['2/9/2024', '3/14/2024'], 'dmy'), 'mdy');
  assert.equal(t.ordenFechaColumna(['2/9/2024', '14/3/2024'], 'mdy'), 'dmy');
  assert.equal(t.ordenFechaColumna(['2/9/2024', '3/4/2024'], 'mdy'), 'mdy'); // ambiguo: el del formato
});

test('aretes e I.E. normalizados; distancia de edición', () => {
  assert.equal(t.normalizarArete("  '225mle "), '225MLE');
  assert.equal(t.normalizarArete('kune   1029g'), 'KUNE 1029G');
  assert.equal(t.normalizarIE('A002 0000-1880 0000 1057900'), 'A0020000188000001057900');
  assert.equal(t.distanciaEdicion('177NFU', '177MFU'), 1);
  assert.equal(t.distanciaEdicion('348MLF', '438MLF'), 2);
  assert.ok(t.distanciaEdicion('225MLE', '81FLB', 2) > 2);
});

test('encabezados truncados cuentan; la leyenda no', () => {
  assert.ok(coincide('fec salid', 'fec salida'));
  assert.ok(coincide('numer', 'numero'));
  assert.ok(coincide('peso pie kg', 'peso pie'));
  assert.equal(coincide('numero numero del animal', 'numero'), 0);
});

test('Ganadero SG (.xlsx de la captura): encabezado en la fila 10, metadatos y filas tipadas', async () => {
  const r = await leerArchivo(fs.readFileSync(path.join(FIX, 'ganadero-sg-salidas.xlsx')), 'ganadero-sg-salidas.xlsx');
  const tabla = leerHojas(r.hojas, SG, { textosExtra: r.textos });
  assert.equal(tabla.encabezado.fila, 10);
  assert.equal(tabla.encabezado.columnas.length, 20);
  assert.deepEqual(tabla.metadatos, { actualizado_a: '2026-10-15', impresion: '21/10/26 10:28:38 AM', finca: '01-003 - ENGORDE  WAGYU' });
  assert.equal(tabla.filas.length, 11); // 5 de la captura + 6 raras; el pie «Total…» no cuenta
  const f1 = tabla.filas[0].valores;
  assert.equal(f1.numero, '225MLE');
  assert.equal(f1.sexo, 'macho');
  assert.equal(f1.fecha_nacimiento, '2024-03-14');
  assert.equal(f1.fecha_salida, '2026-10-15');
  assert.equal(f1.ie, 'A0020000188000001057859');
  assert.equal(f1.peso_salida, 660);
  const raro = tabla.filas[5].valores; // fechas en texto, I.E. con espacios, «760,0»
  assert.equal(raro.numero, '177MFU');
  assert.equal(raro.fecha_nacimiento, '2024-03-01');
  assert.equal(raro.fecha_salida, '2026-10-15');
  assert.equal(raro.ie, 'A0020000188000001057900');
  assert.equal(raro.ultimo_peso, 760);
  assert.match(tabla.filas[7].errores.join(), /no es una fecha válida/);
});

test('raza: códigos conocidos, desconocidos y porcentajes', () => {
  assert.deepEqual(revisarRaza('WAG/50-BRA/37-CEB/12'), []);
  assert.match(revisarRaza('WAG/50-XYZ/50').join(), /desconocida «XYZ»/);
  assert.match(revisarRaza('WAG/50-BRA/20').join(), /suman 70/);
});

test('sacrificio CIISA: .eml, .msg, HTML pegado, Excel pegado y texto de Gmail dan lo mismo', async () => {
  const esperado = ['5256|225MLE|628|378.5', '5257|438MLF|740|460', '5258|81FLB|710|420', '5259|177NFU|732|439', '5260|33FLE|690|416.5', '5261|710FLF|592|341.5'];
  const resumen = (tabla) => tabla.filas.map(f => `${f.valores.numero_canal}|${f.valores.arete}|${f.valores.peso_pie}|${f.valores.peso_canal}`);
  for (const nombre of ['sacrificio-wagyu-15-10-26.eml', 'sacrificio-wagyu-15-10-26.msg', 'sacrificio-pegado-excel.txt', 'sacrificio-pegado-gmail.txt']) {
    const r = await leerArchivo(fs.readFileSync(path.join(FIX, nombre)), nombre);
    const tabla = leerHojas(r.hojas, SAC, { textosExtra: r.textos });
    assert.deepEqual(resumen(tabla), esperado, nombre);
    if (/\.(eml|msg)$/.test(nombre)) assert.equal(tabla.metadatos.fecha_sacrificio, '2026-10-15', nombre);
  }
  const pegado = leerPegado({ html: htmlSacrificio(), texto: 'ignorado' });
  const tabla = leerHojas(pegado.hojas, SAC, { textosExtra: pegado.textos });
  assert.deepEqual(resumen(tabla), esperado);
  assert.equal(tabla.metadatos.fecha_sacrificio, '2026-10-15');
  assert.equal(tabla.filas[0].valores.golpe, '-');
});

test('HTML: tablas anidadas no mezclan filas; entidades decodificadas', () => {
  const tablas = tablasDesdeHtml('<table><tr><td>fuera<table><tr><th>N&uacute;mero</th></tr><tr><td>1&nbsp;</td></tr></table></td></tr></table>');
  assert.deepEqual(tablas[0], [['Número'], ['1']]);
});

test('lector sin encabezado ni formato posicional: no inventa filas', () => {
  const r = leerTabla([['hola', 'mundo'], ['a', 'b']], SG);
  assert.equal(r.encabezado, null);
  assert.equal(r.filas.length, 0);
});
