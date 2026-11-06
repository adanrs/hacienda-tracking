// Pruebas puras (sin MySQL) de la fase 2: lector del reporte de CIISA, lista lote → arete,
// vencimiento, «sin trazabilidad» en etiquetas, nombres de hoja de la solicitud histórica y PDF escaneado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { leerReportes, leerMapaLotes } = require('../src/lib/importador/reporteCiisaTexto');
const { vencimientoDe, resolverVencimiento, sumarMeses } = require('../src/lib/vencimiento');
const { decodificar, esSinTrazabilidad } = require('../src/lib/etiquetas');
const { fechasDeNombre } = require('../src/lib/importador/procesadores/solicitudDeshueseExcel');
const { lecturasFecha } = require('../src/lib/trazabilidadEtiqueta');
const { leerArchivo } = require('../src/lib/importador/archivos');

const FIX = path.join(__dirname, 'fixtures');

test('reporte CIISA: el PDF real (texto pegado sin espacios) se lee completo', async () => {
  const texto = (await require('pdf-parse')(fs.readFileSync(path.join(FIX, 'reporte-produccion-lote-02.pdf')))).text;
  const [r] = leerReportes(texto);
  assert.equal(r.fecha, '2026-10-19');
  assert.equal(r.num_lote, '2');
  assert.equal(r.lote_cc, 2);
  assert.equal(r.tipo_produccion, 'TEMPISQUE');
  assert.equal(r.lineas.length, 27);
  assert.deepEqual(r.lineas.find((l) => l.articulo_codigo === '22229'), { articulo_codigo: '22229', descripcion: 'CH-CHUCK RES', peso_kg: 136.1, unidad: 'KGS', cajas: 5 });
  assert.deepEqual(r.pie, { lote: '2', libras: 773.42, kilos: 350.82, cajas: 31 });
  assert.deepEqual(r.errores, []);
});

test('reporte CIISA: texto pegado con espacios y dos reportes seguidos', () => {
  const t = 'REPORTE DIARIO DE PRODUCCION\nFecha de Produccion: 19/10/26\nNum. Lote 4  Tipo Produccion: TEMPISQUE\nLote CC 04\n'
    + '21231   DELMONICO   21.42   KGS   1\nTotal de Cajas por el Lote #  4   Libras 47.22   Kilos 21.42   1\n'
    + 'REPORTE DIARIO DE PRODUCCION\nFecha de Produccion: 19/10/26\nNum. Lote 5\nLote CC 05\n'
    + '11163 BEEF TRIMMINGS 1,027.22 KGS 3\nTotal de Cajas por el Lote # 5\nLibras 2264.61 Kilos 1,027.22 3';
  const rs = leerReportes(t);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].lineas[0].peso_kg, 21.42);
  assert.equal(rs[1].lineas[0].peso_kg, 1027.22);
  assert.equal(rs[1].pie.kilos, 1027.22); // pie partido en dos líneas
});

test('lista lote → arete del correo', () => {
  const { mapa, repetidos } = leerMapaLotes('2 225MLE\n3\t348MLF\n4   81FLB\n5 177NFU\nLote 6: 33FLE\n7 → 710FLF\nBuenas tardes\nSaludos');
  assert.deepEqual([...mapa], [['2', '225MLE'], ['3', '348MLF'], ['4', '81FLB'], ['5', '177NFU'], ['6', '33FLE'], ['7', '710FLF']]);
  assert.deepEqual(repetidos, []);
  assert.deepEqual(leerMapaLotes('2 AAA111\n2 BBB222').repetidos, ['2']);
});

test('vencimiento = producción + 12 meses (regla del dueño)', () => {
  assert.equal(vencimientoDe('2026-10-19'), '2027-10-19');
  assert.equal(vencimientoDe('2024-02-29'), '2025-02-28');
  assert.equal(sumarMeses('2026-11-30', 3), '2027-02-28');
  assert.equal(vencimientoDe('2026-02-30'), null);
  const igual = resolverVencimiento('2025-01-29', '2026-01-29');
  assert.equal(igual.aviso, null);
  const distinto = resolverVencimiento('2025-01-29', '2025-07-29');
  assert.equal(distinto.fecha, '2025-07-29'); // se respeta el archivo
  assert.match(distinto.aviso, /distinto de producción \+ 12 meses/);
  assert.deepEqual(resolverVencimiento('2025-01-29', null).origen, 'calculada');
});

test('etiquetas: «xxx» y «000000» = sin trazabilidad (advertencia, nunca arete literal)', () => {
  assert.equal(esSinTrazabilidad('xxx'), true);
  assert.equal(esSinTrazabilidad('XxX'), true);
  assert.equal(esSinTrazabilidad('000000'), true);
  assert.equal(esSinTrazabilidad('0XXXXX'), true);
  assert.equal(esSinTrazabilidad('0PG087'), false);
  // Paquete de hamburguesa con relleno 000000 en el arete.
  const p = decodificar('000000266492911250700540F105');
  assert.equal(p.tipo, 'paquete');
  assert.equal(p.campos.arete, null);
  assert.equal(p.campos.areteCrudo, '000000');
  assert.equal(p.campos.trazabilidad, 'sin_trazabilidad');
  assert.ok(p.advertencias.some((a) => a.codigo === 'sin_trazabilidad'));
  assert.ok(!p.errores.some((a) => a.campo === 'arete'));
  const x = decodificar('XXXXXX266492911250700540F105');
  assert.equal(x.campos.arete, null);
  // Caja real del inventario (línea 74): lote = 06/11/25 + lote de deshuese 0035.
  const c = decodificar('2661700874xxx061125003511');
  assert.equal(c.campos.trazabilidad, 'sin_trazabilidad');
  assert.equal(c.campos.loteDeshuese, 35);
  assert.equal(c.campos.fecha, '2025-11-06');
  assert.deepEqual(lecturasFecha('061125', 'DDMMAA'), ['2025-11-06', '2025-06-11']);
  assert.deepEqual(lecturasFecha('231225', 'DDMMAA'), ['2025-12-23']); // día > 12: una sola lectura
});

test('solicitud histórica: fecha desde el nombre de la hoja', () => {
  assert.deepEqual(fechasDeNombre('Deshuese 160524'), ['2024-05-16']);
  assert.deepEqual(fechasDeNombre('Deshuses 8223'), ['2023-02-08']);
  assert.deepEqual(fechasDeNombre('Deshuese 18923').sort(), ['2023-09-18']); // 1/89 no existe
  assert.deepEqual(fechasDeNombre('Deshuses 12423'), ['2023-04-12']); // 1/24 no existe
  assert.deepEqual(fechasDeNombre('Deshuese 11123').sort(), ['2023-01-11', '2023-11-01']); // ambigua: se pregunta
  assert.deepEqual(fechasDeNombre('Cortes y BMS'), []);
});

test('PDF escaneado (sin texto) se marca para la lectura por foto', async () => {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument();
  const partes = []; doc.on('data', (b) => partes.push(b));
  const fin = new Promise((ok) => doc.on('end', ok));
  // Una «hoja escaneada»: solo una imagen, sin capa de texto.
  doc.image(path.join(__dirname, '..', '..', 'maduracion-4niveles.png'), 20, 20, { width: 400 }); doc.end(); await fin;
  await assert.rejects(leerArchivo(Buffer.concat(partes), 'escaneo.pdf'), (e) => e.codigo === 'sin_texto');
});
