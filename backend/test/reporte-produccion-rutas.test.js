// Rutas de /api/reporte-produccion con Express + JWT reales y un pool falso que registra el SQL.
// Verifica permisos (viewer solo lee), validación, 409 de duplicados y que ningún valor del
// request termine concatenado en el SQL (todo va por `?`).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const ExcelJS = require('exceljs');

const ejemplo = require(path.resolve(__dirname, '../../docs/reporte-produccion-diaria/ejemplo-2026-09-21.json'));
const { COLUMNAS_PLANTILLA } = require('../src/lib/reporteProduccion');

const llamadas = [];
const estado = { reporteExiste: false, llaveDe: 5, origExiste: true, deadlock: false, escaneoDuplicado: false };
const dup = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });

async function responder(sql, params) {
  llamadas.push({ sql, params });
  if (/^SELECT id FROM reporte_produccion WHERE id = \? FOR UPDATE/.test(sql)) return [estado.origExiste ? [{ id: Number(params[0]) }] : []];
  if (/^SELECT id FROM reporte_produccion WHERE fecha_produccion/.test(sql)) {
    if (estado.deadlock) throw Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' });
    return [estado.reporteExiste ? [{ id: estado.llaveDe }] : []];
  }
  if (/UNIX_TIMESTAMP\(e\.created_at\) AS escaneado_ts/.test(sql)) {
    return [[{ id: 1, codigo_crudo: 'X', copia: 1, tipo: 'primal', articulo_codigo: '21231', peso_kg: '10.960', lote_cc: 6, escaneado_ts: 1790000000 }]];
  }
  if (/^INSERT INTO reporte_produccion_escaneos/.test(sql.trim())) {
    if (estado.escaneoDuplicado) throw dup();
    return [{ insertId: 77, affectedRows: 1 }];
  }
  if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) return [{ insertId: 9, affectedRows: 1 }];
  if (/FROM animales WHERE numero_trazabilidad IN/.test(sql)) return [[{ id: 40, numero_trazabilidad: '72ELF' }]];
  if (/COUNT\(\*\) AS cajas, ROUND\(SUM\(peso_kg\)/.test(sql)) return [[{ cajas: 3, kg: '30.12' }]];
  // Reporte del día: un lote con CIISA y escaneos.
  if (/FROM reporte_produccion r\s+LEFT JOIN usuarios/.test(sql)) return [[{ id: 5, lote_cc: 6, num_lote: '3', tipo_produccion: 'TEMPISQUE', origen: 'excel_csv' }]];
  if (/FROM reporte_produccion_lineas l\s+JOIN reporte_produccion r/.test(sql)) {
    return [ejemplo.lineas.map(l => ({ lote_cc: 6, articulo_codigo: l.articulo, descripcion: l.descripcion, peso_kg: l.peso.toFixed(3), unidad: 'KGS', cajas: l.cajas }))];
  }
  if (/GROUP BY e\.lote_cc, e\.articulo_codigo/.test(sql)) return [[{ lote_cc: 6, articulo_codigo: '11163', descripcion: null, kg: '97.400', cajas: 4 }]];
  if (/FROM lotes_cc_aretes a/.test(sql)) return [[{ posicion: 6, arete: '72ELF', animal_id: 40 }]];
  return [[]];
}

const conexion = {
  query: responder,
  async beginTransaction() { llamadas.push({ sql: 'BEGIN' }); },
  async commit() { llamadas.push({ sql: 'COMMIT' }); },
  async rollback() { llamadas.push({ sql: 'ROLLBACK' }); },
  release() {},
};
const poolFalso = { query: responder, async getConnection() { return conexion; } };
const rutaDb = path.resolve(__dirname, '../src/models/database.js');
const modDb = new Module(rutaDb);
modDb.filename = rutaDb;
modDb.loaded = true;
modDb.exports = { pool: poolFalso, initDB: async () => {} };
require.cache[rutaDb] = modDb;

const express = require('express');
const jwt = require('jsonwebtoken');
const { authMiddleware, soloLecturaViewer, JWT_SECRET } = require('../src/middleware/auth');

const app = express();
app.use(express.json());
app.use('/api/reporte-produccion', [authMiddleware, soloLecturaViewer], require('../src/routes/reporte-produccion'));

let base;
let server;
test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api/reporte-produccion`;
});
test.after(() => new Promise((ok) => server.close(ok)));
test.beforeEach(() => {
  llamadas.length = 0;
  Object.assign(estado, { reporteExiste: false, llaveDe: 5, origExiste: true, deadlock: false, escaneoDuplicado: false });
});

const token = (rol) => jwt.sign({ id: 1, rol }, JWT_SECRET, { expiresIn: '5m' });
async function pedir(metodo, ruta, rol, body) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token(rol)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const tipo = res.headers.get('content-type') || '';
  return { status: res.status, body: tipo.includes('json') ? await res.json() : await res.arrayBuffer() };
}
const escrituras = () => llamadas.filter(l => /^\s*(UPDATE|DELETE|INSERT)/.test(l.sql));
const PRIMAL_21_09 = '2123100001010960921260610'; // 21231, box 00001, 10.96 kg, 21/09/26, lote 06

test('viewer: lee el reporte pero no escribe nada', async () => {
  assert.equal((await pedir('GET', '/?fecha=2026-09-21', 'viewer')).status, 200);
  assert.equal((await pedir('POST', '/ciisa', 'viewer', ejemplo)).status, 403);
  assert.equal((await pedir('POST', '/escaneos', 'viewer', { codigo: PRIMAL_21_09 })).status, 403);
  assert.equal((await pedir('PUT', '/aretes', 'viewer', { fecha: '2026-09-21', aretes: [] })).status, 403);
  assert.equal((await pedir('DELETE', '/escaneos/1', 'viewer')).status, 403);
  assert.equal(escrituras().length, 0);
});

test('POST /ciisa guarda el ejemplo: 29 filas, totales del pie y aretes', async () => {
  const r = await pedir('POST', '/ciisa', 'operador', ejemplo);
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.totales, { kilos: 319.82, libras: 705.08, cajas: 34 });
  assert.equal(r.body.filas, 29);
  assert.equal(r.body.aretes_guardados, 7);
  assert.deepEqual(r.body.aretes_sin_animal, ['26FLB', '49NKB', '347FLH', '238FL2', '238FL1', '32ELV']);
  const lineas = llamadas.find(l => /INSERT INTO reporte_produccion_lineas/.test(l.sql));
  assert.equal(lineas.params[0].length, 29);
  assert.ok(llamadas.some(l => l.sql === 'COMMIT'));
});

test('POST /ciisa: 409 si ya existe; con reemplazar=true lo sustituye', async () => {
  estado.reporteExiste = true;
  const r = await pedir('POST', '/ciisa', 'admin', ejemplo);
  assert.equal(r.status, 409);
  assert.equal(r.body.existe, true);
  assert.ok(llamadas.some(l => l.sql === 'ROLLBACK'));
  assert.equal(escrituras().length, 0);

  llamadas.length = 0;
  const r2 = await pedir('POST', '/ciisa', 'admin', { ...ejemplo, reemplazar: true });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.reemplazado, true);
  assert.ok(llamadas.some(l => /^DELETE FROM reporte_produccion_lineas WHERE reporte_id = \?/.test(l.sql)));
});

test('POST /ciisa: rechaza entradas inválidas sin tocar la base', async () => {
  const r = await pedir('POST', '/ciisa', 'operador', { ...ejemplo, pie: { kilos: 1, cajas: 34 } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no cuadra/);
  assert.equal((await pedir('POST', '/ciisa', 'operador', { ...ejemplo, origen: "x'); DROP" })).status, 400);
  assert.equal((await pedir('POST', '/ciisa', 'operador', { encabezado: {}, lineas: 'x' })).status, 400);
  assert.equal(escrituras().length, 0);
});

test('GET /: conciliación por lote y artículo', async () => {
  const r = await pedir('GET', '/?fecha=2026-09-21', 'viewer');
  assert.equal(r.status, 200);
  assert.equal(r.body.lotes.length, 1);
  const lote = r.body.lotes[0];
  assert.equal(lote.lote_texto, '06');
  assert.equal(lote.arete, '72ELF');
  assert.deepEqual(lote.resumen.ciisa, { kilos: 319.82, libras: 705.08, cajas: 34 });
  assert.deepEqual(lote.resumen.escaneado, { kilos: 97.4, libras: 214.73, cajas: 4 });
  assert.equal(lote.resumen.estado, 'con_diferencias');
  assert.equal(lote.filas.find(f => f.articulo === '11163').estado, 'cuadra');
  assert.equal(lote.filas.find(f => f.articulo === '21231').estado, 'solo_ciisa');
});

test('GET /: valida parámetros', async () => {
  assert.equal((await pedir('GET', '/?fecha=21-09-2026', 'viewer')).status, 400);
  assert.equal((await pedir('GET', "/?fecha=2026-09-21&lote_cc=1%20OR%201=1", 'viewer')).status, 400);
  assert.equal((await pedir('GET', '/escaneos/1%2F..', 'viewer')).status, 404);
  assert.equal((await pedir('DELETE', '/escaneos/1%20OR%201', 'admin')).status, 400);
});

test('GET /excel y /plantilla devuelven .xlsx', async () => {
  const r = await pedir('GET', '/excel?fecha=2026-09-21&lote_cc=6', 'viewer');
  assert.equal(r.status, 200);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(r.body);
  assert.equal(libro.getWorksheet('Lote CC 06').getCell('E38').value, 34);
  const p = await pedir('GET', '/plantilla', 'viewer');
  assert.equal(p.status, 200);
  assert.ok(p.body.byteLength > 1000);
});

test('POST /escaneos: registra una etiqueta de deshuese y bloquea duplicados', async () => {
  const r = await pedir('POST', '/escaneos', 'operador', { codigo: PRIMAL_21_09, fecha_esperada: '2026-09-21' });
  assert.equal(r.status, 201);
  assert.equal(r.body.tipo, 'primal');
  assert.equal(r.body.lote_cc, 6);
  assert.equal(r.body.peso_kg, 10.96);
  assert.deepEqual(r.body.lote, { cajas: 3, kg: 30.12 });
  const ins = llamadas.find(l => /INSERT INTO reporte_produccion_escaneos/.test(l.sql));
  assert.equal(ins.params[0], PRIMAL_21_09);
  assert.ok(!ins.sql.includes(PRIMAL_21_09), 'el código va por parámetro');

  estado.escaneoDuplicado = true;
  const d = await pedir('POST', '/escaneos', 'operador', { codigo: PRIMAL_21_09 });
  assert.equal(d.status, 409);
  assert.equal(d.body.motivo, 'duplicada');
  assert.equal(d.body.puede_confirmar, false, 'un primal tiene Box único');
});

test('POST /escaneos: otra fecha, paquete y ambigua', async () => {
  const f = await pedir('POST', '/escaneos', 'operador', { codigo: PRIMAL_21_09, fecha_esperada: '2026-09-22' });
  assert.equal(f.status, 409);
  assert.equal(f.body.motivo, 'otra_fecha');
  const p = await pedir('POST', '/escaneos', 'operador', { codigo: '34GKAE266322309243300416F101' });
  assert.equal(p.status, 422);
  assert.equal(p.body.motivo, 'paquete');
  const a = await pedir('POST', '/escaneos', 'operador', { codigo: '2664000469123220125003111' });
  assert.equal(a.status, 422);
  assert.deepEqual(a.body.alternativas, ['caja', 'primal']);
  assert.equal((await pedir('POST', '/escaneos', 'operador', { codigo: PRIMAL_21_09, tipo: 'x' })).status, 400);
  assert.equal(escrituras().length, 0);
});

test('PUT /aretes reemplaza la tabla del día', async () => {
  const r = await pedir('PUT', '/aretes', 'operador', { fecha: '2026-09-21', aretes: ejemplo.aretesPorPosicion });
  assert.equal(r.status, 200);
  assert.equal(r.body.guardados, 7);
  const del = llamadas.find(l => /^DELETE FROM lotes_cc_aretes/.test(l.sql));
  assert.deepEqual(del.params, ['2026-09-21', [6, 7, 8, 9, 10, 11, 12]]);
  const malo = await pedir('PUT', '/aretes', 'operador', { fecha: '2026-09-21', aretes: [{ posicion: '06', arete: "72'ELF" }] });
  assert.equal(malo.status, 400);
});

test('POST /ciisa/importar: vista previa desde .xlsx sin guardar', async () => {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Reporte');
  hoja.addRow(COLUMNAS_PLANTILLA);
  for (const l of ejemplo.lineas) hoja.addRow(['21/09/26', '3', 'TEMPISQUE', '06', l.articulo, l.descripcion, l.peso, l.unidad, l.cajas]);
  const buf = Buffer.from(await libro.xlsx.writeBuffer());
  const fd = new FormData();
  fd.append('archivo', new Blob([buf]), 'deshuese-21-09.xlsx');
  const res = await fetch(`${base}/ciisa/importar`, { method: 'POST', headers: { Authorization: `Bearer ${token('operador')}` }, body: fd });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.reportes.length, 1);
  assert.deepEqual(body.reportes[0].totales, { kilos: 319.82, libras: 705.08, cajas: 34 });
  assert.equal(escrituras().length, 0);

  const fd2 = new FormData();
  fd2.append('archivo', new Blob([Buffer.from('hola')]), 'malo.xlsx');
  const r2 = await fetch(`${base}/ciisa/importar`, { method: 'POST', headers: { Authorization: `Bearer ${token('operador')}` }, body: fd2 });
  assert.equal(r2.status, 400);
  const fd3 = new FormData();
  fd3.append('archivo', new Blob([Buffer.from('x')]), 'virus.exe');
  const r3 = await fetch(`${base}/ciisa/importar`, { method: 'POST', headers: { Authorization: `Bearer ${token('operador')}` }, body: fd3 });
  assert.equal(r3.status, 400);
});

test('POST /ciisa con id: corregir fecha/lote actualiza el mismo reporte, no crea otro', async () => {
  const cambiado = { ...ejemplo, id: 5, encabezado: { ...ejemplo.encabezado, loteCC: '07' } };
  const r = await pedir('POST', '/ciisa', 'operador', cambiado);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 5);
  assert.equal(r.body.reemplazado, true);
  assert.ok(!llamadas.some(l => /^INSERT INTO reporte_produccion \(/.test(l.sql.trim())), 'no inserta un encabezado nuevo');
  const upd = llamadas.find(l => /^UPDATE reporte_produccion SET fecha_produccion = \?, lote_cc = \?/.test(l.sql));
  assert.deepEqual([upd.params[0], upd.params[1], upd.params.at(-1)], ['2026-09-21', 7, 5]);

  // Corregir sin cambiar la llave: la llave la tiene el propio reporte, no pide «reemplazar».
  llamadas.length = 0;
  estado.reporteExiste = true;
  estado.llaveDe = 5;
  assert.equal((await pedir('POST', '/ciisa', 'operador', { ...ejemplo, id: 5 })).status, 200);
});

test('POST /ciisa con id: si la llave nueva es de OTRO reporte, 409; con reemplazar se borra el otro', async () => {
  estado.reporteExiste = true;
  estado.llaveDe = 8;
  const r = await pedir('POST', '/ciisa', 'admin', { ...ejemplo, id: 5 });
  assert.equal(r.status, 409);
  assert.equal(r.body.id, 8);
  assert.equal(escrituras().length, 0);

  llamadas.length = 0;
  const r2 = await pedir('POST', '/ciisa', 'admin', { ...ejemplo, id: 5, reemplazar: true });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.reemplazo_otro, 8);
  const del = llamadas.find(l => /^DELETE FROM reporte_produccion WHERE id = \?/.test(l.sql));
  assert.deepEqual(del.params, [8]);
  const upd = llamadas.find(l => /^UPDATE reporte_produccion SET/.test(l.sql));
  assert.equal(upd.params.at(-1), 5);
  assert.ok(llamadas.indexOf(del) < llamadas.indexOf(upd), 'libera la llave antes de reutilizarla');
});

test('POST /ciisa con id: 404 si ya no existe; id no numérico 400', async () => {
  estado.origExiste = false;
  assert.equal((await pedir('POST', '/ciisa', 'operador', { ...ejemplo, id: 99 })).status, 404);
  assert.equal((await pedir('POST', '/ciisa', 'operador', { ...ejemplo, id: '5 OR 1=1' })).status, 400);
  assert.equal(escrituras().length, 0);
});

test('POST /ciisa concurrente: deadlock de MySQL se responde 409, no 500', async () => {
  estado.deadlock = true;
  const r = await pedir('POST', '/ciisa', 'operador', ejemplo);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Otro usuario está guardando/);
  assert.ok(llamadas.some(l => l.sql === 'ROLLBACK'));
});

test('GET /escaneos: la hora se muestra en hora de Costa Rica (UTC−6)', async () => {
  const r = await pedir('GET', '/escaneos?fecha=2026-09-21', 'viewer');
  assert.equal(r.status, 200);
  // 1790000000 = 2026-09-21 14:13:20 UTC → 08:13 en Costa Rica.
  assert.equal(new Date(1790000000 * 1000).toISOString(), '2026-09-21T14:13:20.000Z');
  assert.equal(r.body[0].escaneado, '2026-09-21 08:13');
  assert.equal(r.body[0].escaneado_ts, undefined);
});

test('POST /ciisa/importar: Excel desmedido → 400 con mensaje claro', async () => {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Reporte');
  hoja.addRow(COLUMNAS_PLANTILLA);
  hoja.getCell('A6000').value = 'x';
  const fd = new FormData();
  fd.append('archivo', new Blob([Buffer.from(await libro.xlsx.writeBuffer())]), 'grande.xlsx');
  const res = await fetch(`${base}/ciisa/importar`, { method: 'POST', headers: { Authorization: `Bearer ${token('operador')}` }, body: fd });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.error, /6000 filas; el máximo es 5000/);
});
