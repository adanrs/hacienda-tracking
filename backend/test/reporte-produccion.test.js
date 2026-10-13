// Reporte Diario de Producción: validación, importador (Excel/CSV), totales del pie,
// conciliación y Excel de salida. Prueba de aceptación: el ejemplo real de CIISA del
// 21/09/26 debe dar 319.82 kg, 705.08 lb y 34 cajas, tanto capturado como importado de Excel.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('exceljs');

const rp = require('../src/lib/reporteProduccion');
const excel = require('../src/lib/reporteProduccionExcel');
const ejemplo = require(path.resolve(__dirname, '../../docs/reporte-produccion-diaria/ejemplo-2026-09-21.json'));

const copia = (o) => JSON.parse(JSON.stringify(o));

/** Etiqueta de primal sintética: código + box + peso (centésimas) + MMDDAA + lote + sufijo. */
const primal = (codigo, box, kg, mmddaa, lote, sufijo = '10') =>
  `${codigo}${String(box).padStart(5, '0')}${String(Math.round(kg * 100)).padStart(5, '0')}${mmddaa}${String(lote).padStart(2, '0')}${sufijo}`;

test('aceptación: el ejemplo de CIISA del 21/09/26 da 319.82 kg, 705.08 lb y 34 cajas', () => {
  const v = rp.validarReporte(copia(ejemplo));
  assert.equal(v.fecha, '2026-09-21');
  assert.equal(v.lote_cc, 6);
  assert.equal(v.num_lote, '3');
  assert.equal(v.tipo_produccion, 'TEMPISQUE');
  assert.equal(v.lineas.length, 29);
  assert.deepEqual(v.totales, { kilos: 319.82, libras: 705.08, cajas: 34 });
  // Coincide con el pie que imprimió CIISA.
  assert.equal(v.totales.kilos, ejemplo.pie.kilos);
  assert.equal(v.totales.libras, ejemplo.pie.libras);
  assert.equal(v.totales.cajas, ejemplo.pie.cajas);
  assert.equal(v.aretes.length, 7);
  assert.deepEqual(v.aretes[0], { posicion: 6, arete: '72ELF' });
});

test('aceptación vía importador: Excel con la plantilla → mismos totales', async () => {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Reporte');
  hoja.addRow(['REPORTE DIARIO DE PRODUCCION']); // título arriba: el importador busca la fila de títulos
  hoja.addRow(rp.COLUMNAS_PLANTILLA);
  for (const l of ejemplo.lineas) {
    hoja.addRow(['21/09/26', '3', 'TEMPISQUE', '06', l.articulo, l.descripcion, l.peso, l.unidad, l.cajas]);
  }
  hoja.addRow(['Total de Cajas por el Lote #', '3', '', '', 'Libras', 705.08, 319.82, '', 34]); // se ignora
  const aretes = libro.addWorksheet('Aretes');
  aretes.addRow(['Fecha', 'Posición', 'Arete']);
  for (const a of ejemplo.aretesPorPosicion) aretes.addRow(['21/09/26', a.posicion, a.arete]);
  const buffer = await libro.xlsx.writeBuffer();

  const leido = await excel.leerLibro(Buffer.from(buffer));
  const r = rp.reportesDesdeFilas(leido.reporte[0]);
  assert.deepEqual(r.errores, []);
  assert.equal(r.reportes.length, 1);
  assert.deepEqual(r.reportes[0].totales, { kilos: 319.82, libras: 705.08, cajas: 34 });
  assert.deepEqual(r.reportes[0].encabezado, { fechaProduccion: '2026-09-21', numLote: '3', tipoProduccion: 'TEMPISQUE', loteCC: '06' });
  const a = rp.aretesDesdeFilas(leido.aretes);
  assert.deepEqual(a.errores, []);
  assert.equal(a.aretes.length, 7);
  assert.deepEqual(a.aretes[4], { fecha: '2026-09-21', posicion: 10, arete: '238FL2' });

  // La vista previa se puede guardar tal cual: pasa la misma validación que la captura manual.
  const v = rp.validarReporte({ ...r.reportes[0], pie: ejemplo.pie });
  assert.equal(v.totales.kilos, 319.82);
});

test('importador CSV con «;» y coma decimal (Excel en español)', () => {
  const csv = '﻿Fecha;Num. Lote;Tipo producción;Lote CC;Artículo;Descripción;Peso;Unidad;Cajas\r\n'
    + '21/09/26;3;TEMPISQUE;06;11163;"BEEF; TRIMMINGS";97,40;KGS;4\r\n'
    + '21/09/26;3;TEMPISQUE;06;21231;DELMONICO;21,92;KGS;2\r\n'
    + '21/09/26;3;TEMPISQUE;07;21231;DELMONICO;1,250;KGS;1\r\n';
  const { filas, separador } = rp.parsearCsv(csv);
  assert.equal(separador, ';');
  const r = rp.reportesDesdeFilas(filas, { comaDecimal: true });
  assert.deepEqual(r.errores, []);
  assert.equal(r.reportes.length, 2, 'un reporte por lote CC');
  assert.equal(r.reportes[0].lineas[0].descripcion, 'BEEF; TRIMMINGS');
  assert.deepEqual(r.reportes[0].totales, { kilos: 119.32, libras: 263.06, cajas: 6 });
  assert.equal(r.reportes[1].lineas[0].peso, 1.25, 'con «;» la coma es decimal aunque tenga 3 cifras');
});

test('importador: informa columnas faltantes y filas malas sin inventar datos', () => {
  assert.match(rp.reportesDesdeFilas([['Artículo', 'Peso']]).errores[0], /Faltan columnas obligatorias: Fecha, Lote CC, Cajas/);
  assert.match(rp.reportesDesdeFilas([['hola']]).errores[0], /No se encontró la fila de títulos/);
  const r = rp.reportesDesdeFilas([
    rp.COLUMNAS_PLANTILLA,
    ['31/02/26', '3', 'T', '06', '11163', 'X', 1, 'KGS', 1],
    ['21/09/26', '3', 'T', '06', '1116', 'X', 1, 'KGS', 1],
  ]);
  assert.match(r.errores[0], /Fila 2: fecha «31\/02\/26» inválida/);
  assert.match(r.errores[1], /5 dígitos/);
});

test('validación estricta del reporte', () => {
  const malo = (cambio) => {
    const b = copia(ejemplo);
    cambio(b);
    try { rp.validarReporte(b); } catch (e) { assert.ok(e instanceof rp.ErrorValidacion); return e.detalles.join(' | '); }
    assert.fail('debía rechazar');
  };
  assert.match(malo(b => { b.pie.kilos = 300; }), /no cuadra con la suma de las filas \(319\.82\)/);
  assert.match(malo(b => { b.pie.cajas = 33; }), /total de cajas del pie \(33\)/);
  assert.match(malo(b => { b.lineas.push({ ...b.lineas[0] }); }), /ya está en la fila 1/);
  assert.match(malo(b => { b.lineas[0].peso = -1; }), /peso inválido/);
  assert.match(malo(b => { b.lineas[0].peso = 1.2345; }), /3 decimales/);
  assert.match(malo(b => { b.lineas[0].cajas = 1.5; }), /entero/);
  assert.match(malo(b => { b.lineas[0].unidad = 'LBS'; }), /no soportada/);
  assert.match(malo(b => { b.lineas[0].articulo = "1'; DROP"; }), /5 dígitos/);
  assert.match(malo(b => { b.encabezado.loteCC = 'abc'; }), /Lote CC inválido/);
  assert.match(malo(b => { b.encabezado.fechaProduccion = '2026-13-01'; }), /Fecha de producción inválida/);
  assert.match(malo(b => { b.lineas = []; }), /al menos una fila/);
  assert.match(malo(b => { b.aretesPorPosicion.push({ posicion: '13', arete: '72ELF' }); }), /72ELF está en las posiciones 06 y 13/);
  assert.match(malo(b => { b.aretesPorPosicion.push({ posicion: '06', arete: 'ZZZ1' }); }), /posición 06 está repetida/);
  assert.throws(() => rp.validarReporte([]), rp.ErrorValidacion);
});

test('lectura de números y fechas', () => {
  assert.equal(rp.parsearNumero('97.40'), 97.4);
  assert.equal(rp.parsearNumero('97,40'), 97.4);
  assert.equal(rp.parsearNumero('0,500'), 0.5);
  assert.equal(rp.parsearNumero('1,250'), 1250);
  assert.equal(rp.parsearNumero('1,250', { comaDecimal: true }), 1.25);
  assert.equal(rp.parsearNumero('1.234,56'), 1234.56);
  assert.equal(rp.parsearNumero('1,234.56'), 1234.56);
  assert.ok(Number.isNaN(rp.parsearNumero('12kg')));
  assert.equal(rp.parsearFecha('21/09/26'), '2026-09-21');
  assert.equal(rp.parsearFecha('21/09/2026'), '2026-09-21');
  assert.equal(rp.parsearFecha('2026-09-21'), '2026-09-21');
  assert.equal(rp.parsearFecha(new Date(Date.UTC(2026, 8, 21))), '2026-09-21');
  assert.equal(rp.parsearFecha('09/31/26'), null, 'nunca MM/DD');
  assert.equal(rp.parsearLoteCC('0006'), 6);
  assert.equal(rp.parsearLoteCC('0'), null);
  assert.equal(rp.normalizarArete(' 72elf '), '72ELF');
  assert.equal(rp.normalizarArete('0103-M'), '0103-M');
  assert.equal(rp.normalizarArete('72 ELF;'), null);
});

test('conciliación por artículo: cuadra, diferencia, no escaneado y no declarado', () => {
  const ciisa = [
    { articulo_codigo: '11163', descripcion: 'BEEF TRIMMINGS', peso_kg: 97.4, unidad: 'KGS', cajas: 4 },
    { articulo_codigo: '21231', descripcion: 'DELMONICO', peso_kg: 21.92, unidad: 'KGS', cajas: 2 },
    { articulo_codigo: '22229', descripcion: 'CH-CHUCK RES', peso_kg: 54.44, unidad: 'KGS', cajas: 2 },
  ];
  const esc = [
    { articulo_codigo: '11163', kg: 97.4, cajas: 4 },
    { articulo_codigo: '21231', kg: 10.96, cajas: 1 },
    { articulo_codigo: '30124', descripcion: 'RABO', kg: 1.68, cajas: 1 },
  ];
  const { filas, resumen } = rp.conciliar(ciisa, esc);
  const por = Object.fromEntries(filas.map(f => [f.articulo, f]));
  assert.equal(por['11163'].estado, 'cuadra');
  assert.equal(por['21231'].estado, 'diferencia');
  assert.equal(por['21231'].dif_kg, -10.96);
  assert.equal(por['21231'].dif_cajas, -1);
  assert.equal(por['22229'].estado, 'solo_ciisa');
  assert.equal(por['22229'].dif_cajas, -2);
  assert.equal(por['30124'].estado, 'solo_escaneo');
  assert.equal(resumen.estado, 'con_diferencias');
  assert.equal(resumen.filas_con_diferencia, 3);
  assert.deepEqual(resumen.ciisa, { kilos: 173.76, libras: 383.07, cajas: 8 });
  assert.deepEqual(resumen.diferencia, { kilos: -63.72, cajas: -2 });

  assert.equal(rp.conciliar(ciisa, []).resumen.estado, 'falta_escaneo');
  assert.equal(rp.conciliar([], esc).resumen.estado, 'falta_ciisa');
  // Diferencia de redondeo (< 1 centésima) cuadra.
  assert.equal(rp.conciliar([ciisa[1]], [{ articulo_codigo: '21231', kg: 21.924, cajas: 2 }]).filas[0].estado, 'cuadra');
});

test('escaneo: primal y caja de deshuese sí; paquete no; ambigua pide el tipo', () => {
  const p = rp.etiquetaParaReporte(primal('21231', 1, 10.96, '092126', 6));
  assert.equal(p.ok, true);
  assert.deepEqual(
    { tipo: p.etiqueta.tipo, art: p.etiqueta.articulo_codigo, kg: p.etiqueta.peso_kg, f: p.etiqueta.fecha_deshuese, lote: p.etiqueta.lote_cc },
    { tipo: 'primal', art: '21231', kg: 10.96, f: '2026-09-21', lote: 6 },
  );

  const c = rp.etiquetaParaReporte('2664000469xxx220125003111');
  assert.equal(c.ok, true);
  assert.equal(c.etiqueta.tipo, 'caja');
  assert.equal(c.etiqueta.lote_cc, 31);
  assert.equal(c.etiqueta.fecha_deshuese, '2025-01-22');

  const paq = rp.etiquetaParaReporte('34GKAE266322309243300416F101');
  assert.equal(paq.ok, false);
  assert.equal(paq.motivo, 'paquete');

  // 25 dígitos con código de serie F1: puede ser caja o primal.
  const amb = rp.etiquetaParaReporte('2664000469123220125003111');
  assert.equal(amb.ok, false);
  assert.equal(amb.motivo, 'ambigua');
  const elegida = rp.etiquetaParaReporte('2664000469123220125003111', 'caja');
  assert.equal(elegida.ok, true);
  assert.equal(elegida.etiqueta.tipo, 'caja');

  assert.equal(rp.etiquetaParaReporte('123').motivo, 'desconocida');
});

test('Excel de salida: formato CIISA con pie, conciliación y aretes', async () => {
  const v = rp.validarReporte(copia(ejemplo));
  const { filas, resumen } = rp.conciliar(v.lineas, [{ articulo_codigo: '11163', kg: 97.4, cajas: 4 }]);
  const libro = excel.construirLibroReporte({
    fecha: '2026-09-21',
    lotes: [{ lote_cc: 6, arete: '72ELF', encabezado: { num_lote: '3', tipo_produccion: 'TEMPISQUE' }, filas, resumen }],
    aretes: v.aretes,
  });
  const buf = await libro.xlsx.writeBuffer();
  const leido = new ExcelJS.Workbook();
  await leido.xlsx.load(buf);
  const h = leido.getWorksheet('Lote CC 06');
  assert.ok(h, 'una hoja por lote CC');
  assert.equal(h.getCell('A1').value, 'REPORTE DIARIO DE PRODUCCION');
  assert.equal(h.getCell('C3').value, '21/09/26');
  assert.equal(h.getCell('B4').value, '3');
  assert.equal(h.getCell('E4').value, 'TEMPISQUE');
  assert.equal(h.getCell('B5').value, '06');
  assert.equal(h.getCell('A8').value, '11163');
  assert.equal(h.getCell('C8').value, 97.4);
  assert.equal(h.getCell('K8').value, 'Cuadra');
  assert.equal(h.getCell('K9').value, 'No escaneado');
  // Pie: 29 filas (8..36), fila en blanco, pie en la 38.
  assert.match(String(h.getCell('A38').value), /Total de Cajas por el Lote # 3/);
  assert.equal(h.getCell('C38').value, 319.82);
  assert.equal(h.getCell('E38').value, 34);
  assert.match(String(h.getCell('B38').value), /Libras 705\.08/);
  assert.equal(h.getCell('C39').value, 705.08);
  assert.equal(h.getCell('M8').value, '06');
  assert.equal(h.getCell('N8').value, '72ELF');
  assert.equal(h.getCell('N14').value, '32ELV');
});

test('plantilla: se puede descargar y volver a importar', async () => {
  const buf = await excel.construirPlantilla().xlsx.writeBuffer();
  const leido = await excel.leerLibro(Buffer.from(buf));
  const r = rp.reportesDesdeFilas(leido.reporte[0]);
  assert.deepEqual(r.errores, []);
  assert.equal(r.reportes.length, 1);
  assert.equal(r.reportes[0].lineas.length, 2);
  assert.equal(rp.aretesDesdeFilas(leido.aretes).aretes.length, 2);
});

test('la pantalla lee los números igual que el backend (numeros.js vs parsearNumero)', async () => {
  const { pathToFileURL } = require('node:url');
  const { numeroDe } = await import(pathToFileURL(path.resolve(__dirname, '../../frontend/src/pages/reporte-produccion/numeros.js')).href);
  const casos = ['97.40', '97,40', '0,500', '12,345', '1,250', '1,234.56', '1.234,56', '1,234,567', '-2,5', '12kg', '', ' 3 ', 7, '0.72', '1.5.3'];
  for (const c of casos) {
    const a = numeroDe(c);
    const b = rp.parsearNumero(c);
    assert.ok(Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b)), `«${c}»: pantalla ${a} vs backend ${b}`);
  }
  assert.equal(numeroDe('0,500'), 0.5);
  assert.equal(numeroDe('12,345'), 12345);
});

test('leerLibro: rechaza libros con demasiadas filas, columnas u hojas', async () => {
  const conFilas = new ExcelJS.Workbook();
  conFilas.addWorksheet('Reporte').getCell('A5001').value = 1;
  await assert.rejects(excel.leerLibro(Buffer.from(await conFilas.xlsx.writeBuffer())), (e) => e instanceof excel.ErrorLibro && /5001 filas/.test(e.message));

  const conColumnas = new ExcelJS.Workbook();
  conColumnas.addWorksheet('Reporte').getRow(1).getCell(61).value = 1;
  await assert.rejects(excel.leerLibro(Buffer.from(await conColumnas.xlsx.writeBuffer())), /61 columnas/);

  const conHojas = new ExcelJS.Workbook();
  for (let i = 0; i < 11; i++) conHojas.addWorksheet(`H${i}`);
  await assert.rejects(excel.leerLibro(Buffer.from(await conHojas.xlsx.writeBuffer())), /11 hojas/);

  // Justo en el tope sí entra.
  const enTope = new ExcelJS.Workbook();
  enTope.addWorksheet('Reporte').getCell('A5000').value = 1;
  await excel.leerLibro(Buffer.from(await enTope.xlsx.writeBuffer()));
});
