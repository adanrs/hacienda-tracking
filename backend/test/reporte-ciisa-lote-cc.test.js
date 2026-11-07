// El arete del Reporte diario de producción de CIISA se liga por «Lote CC», NO por «Num. Lote».
// Fixtures: los 5 PDF reales del deshuese del 19/03/26 (falta el PDF del Num. Lote 4 = Lote CC 38) y la
// lista de Juan Carlos (lote-cc-arete.csv): Num. Lote 1→Lote CC 35=279SKF, 2→36=255CKF, 3→37=599SKF,
// 5→39=1SKC, 6→40=477AKF. El traslado de custodia 1824 dice «LOTE 35» y las etiquetas traen 35 / 0035.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pdfParse = require('pdf-parse');
const { leerReportes } = require('../src/lib/importador/reporteCiisaTexto');
const procesador = require('../src/lib/importador/procesadores/reporteProduccionCiisa');

const DIR = path.join(__dirname, 'fixtures', 'deshuese-19-03-2026');
const ESPERADOS = [
  { archivo: '19032026-1.pdf', num_lote: '1', lote_cc: 35, kg: 405.5, lb: 893.97, cajas: 34, arete: '279SKF' },
  { archivo: '19032026-2.pdf', num_lote: '2', lote_cc: 36, kg: 360.34, lb: 794.41, cajas: 33, arete: '255CKF' },
  { archivo: '19032026-3.pdf', num_lote: '3', lote_cc: 37, kg: 360.92, lb: 795.68, cajas: 35, arete: '599SKF' },
  { archivo: '19032026-5.pdf', num_lote: '5', lote_cc: 39, kg: 316.76, lb: 698.33, cajas: 34, arete: '1SKC' },
  { archivo: '19032026-6.pdf', num_lote: '6', lote_cc: 40, kg: 310.64, lb: 684.84, cajas: 34, arete: '477AKF' },
];
// Tabla del correo / de JC: Lote CC → arete (el 38 no tiene PDF en la tanda).
const MAPA_LOTE_CC = '35 279SKF\n36 255CKF\n37 599SKF\n38 773SKH\n39 1SKC\n40 477AKF';
// La misma lista mal armada por Num. Lote (el bug): no debe ligar nada.
const MAPA_NUM_LOTE = '1 279SKF\n2 255CKF\n3 599SKF\n4 773SKH\n5 1SKC\n6 477AKF';

const textos = new Map();
async function texto(archivo) {
  if (!textos.has(archivo)) textos.set(archivo, (await pdfParse(fs.readFileSync(path.join(DIR, archivo)))).text);
  return textos.get(archivo);
}

for (const e of ESPERADOS) {
  test(`PDF real ${e.archivo}: Num. Lote ${e.num_lote}, Lote CC ${e.lote_cc}, ${e.kg} kg`, async () => {
    const [r, ...resto] = leerReportes(await texto(e.archivo));
    assert.equal(resto.length, 0);
    assert.deepEqual(r.errores, []);
    assert.equal(r.fecha, '2026-03-19');
    assert.equal(r.num_lote, e.num_lote);
    assert.equal(r.lote_cc, e.lote_cc);
    assert.equal(r.tipo_produccion, 'TEMPISQUE');
    assert.equal(r.lineas.length, 28);
    const kg = Math.round(r.lineas.reduce((a, l) => a + l.peso_kg, 0) * 100) / 100;
    assert.equal(kg, e.kg);
    assert.equal(r.lineas.reduce((a, l) => a + l.cajas, 0), e.cajas);
    assert.deepEqual(r.pie, { lote: e.num_lote, libras: e.lb, kilos: e.kg, cajas: e.cajas });
    assert.deepEqual(r.lineas[0], { articulo_codigo: '11163', descripcion: 'BEEF TRIMMINGS', peso_kg: r.lineas[0].peso_kg, unidad: 'KGS', cajas: r.lineas[0].cajas });
  });
}

test('PDF real: «Lote CC» seguido de las libras no se lee como lote (893.97 no es el Lote CC)', () => {
  const [r] = leerReportes('REPORTE DIARIO DE PRODUCCION\nFecha de Produccion:\n19/03/26\n1Num. LoteTEMPISQUETipo Produccion:\n1\n'
    + '21231\nArticulo\nDELMONICO\n      6.56\nPeso\nKGS\nUnidad\n1\nCajas\nTotal de Cajas por el Lote # 1\n Lote CC\n 14.46 6.56KilosLibras');
  assert.equal(r.lote_cc, null);
  assert.match(r.errores.join(' '), /Lote CC/);
  assert.equal(r.num_lote, '1'); // el Num. Lote no se usa como Lote CC
});

test('PDF real: columnas descuadradas = error, no se adivinan las líneas', () => {
  const [r] = leerReportes('REPORTE DIARIO DE PRODUCCION\nFecha de Produccion:\n19/03/26\n1Num. LoteTEMPISQUETipo Produccion:\n2\n'
    + '21231\n22229\nArticulo\nDELMONICO\nCH-CHUCK RES\n      6.56\nPeso\nKGS\nKGS\nUnidad\n1\n1\nCajas\nTotal de Cajas por el Lote # 1\n 35Lote CC\n 14.46 6.56KilosLibras');
  assert.deepEqual(r.lineas, []);
  assert.match(r.errores.join(' '), /columnas del PDF no cuadran/);
});

// Conn falso: los 6 animales del deshuese sacrificados el 17/03/26, catálogo con todos los códigos y
// nada cargado todavía.
const ANIMALES = ['279SKF', '255CKF', '599SKF', '773SKH', '1SKC', '477AKF'];
function connFalso() {
  return {
    async query(sql, params = []) {
      if (/FROM sacrificios s JOIN animales a/.test(sql)) {
        return [ANIMALES.map((a, i) => ({ sacrificio_id: 100 + i, animal_id: 200 + i, fecha_sacrificio: '2026-03-17', numero_canal: String(i + 1), peso_canal: 500, numero_trazabilidad: a }))];
      }
      if (/FROM lotes_cc_aretes l\s+JOIN reporte_produccion/.test(sql)) return [[]];
      if (/FROM catalogo_cortes WHERE codigo IN/.test(sql)) return [params.map((codigo) => ({ codigo, nombre: codigo, activo: 1, tipo: 'subprimal' }))];
      if (/FROM reporte_produccion r WHERE/.test(sql)) return [[]];
      if (/FROM lotes_cc_aretes WHERE/.test(sql)) return [[]];
      throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
    },
  };
}

async function planificar(mapa, extra = {}) {
  const documentos = [];
  for (const e of ESPERADOS) documentos.push({ nombre: e.archivo, ext: 'pdf', texto: await texto(e.archivo) });
  return procesador.planificar(connFalso(), 'reporte-produccion-ciisa', { mapa, ...extra }, { lectura: { documentos } });
}

test('con la tabla Lote CC → arete cada PDF queda ligado a su arete (por Lote CC, no por Num. Lote)', async () => {
  const plan = await planificar(MAPA_LOTE_CC);
  assert.equal(plan.filas.length, 5);
  for (const e of ESPERADOS) {
    const f = plan.filas.find((x) => x.documento === e.archivo);
    assert.equal(f.accion, 'nuevo', `${e.archivo}: ${f.errores.join(' ')}`);
    assert.equal(f.num_lote, e.num_lote);
    assert.equal(f.lote_cc, e.lote_cc);
    assert.equal(f.lote_clave, String(e.lote_cc));
    assert.equal(f.arete, e.arete);
    assert.equal(f.kilos, e.kg);
    assert.equal(f.cajas, e.cajas);
    assert.equal(f.trazabilidad, 'con_arete');
  }
  assert.equal(plan.trazabilidad.pct, 100);
  // El Lote CC 38 (773SKH) viene en la tabla pero su PDF no está en la tanda.
  assert.deepEqual(plan.faltantes, [{ lote: '38', arete: '773SKH' }]);
});

test('la lista armada por Num. Lote (el bug) ya no liga ningún arete', async () => {
  const plan = await planificar(MAPA_NUM_LOTE);
  assert.ok(plan.filas.every((f) => !f.arete && f.trazabilidad === 'sin_trazabilidad'));
  assert.ok(plan.filas.every((f) => f.avisos.some((a) => /lote CC \d+ no viene en la lista Lote CC → arete/.test(a))));
});

test('correcciones y «sin animal» van por Lote CC', async () => {
  const sinLote39 = MAPA_LOTE_CC.replace('39 1SKC\n', '');
  const plan = await planificar(sinLote39, { correcciones: { 39: '1SKC' }, sin_animal: { 40: true } });
  const l39 = plan.filas.find((f) => f.lote_cc === 39);
  assert.equal(l39.arete, '1SKC');
  assert.equal(l39.trazabilidad, 'confirmada_a_mano');
  const l40 = plan.filas.find((f) => f.lote_cc === 40);
  assert.equal(l40.arete, undefined);
  assert.equal(l40.trazabilidad, 'sin_trazabilidad');
});
