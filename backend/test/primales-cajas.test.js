// Candado de deshuese cerrado en primales (POST, PUT, DELETE) y estados de caja que solo
// se fijan por su flujo propio. Express + JWT reales con pool falso que registra el SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const llamadas = [];
let estadoDeshuese = 'cerrado';
let estadoCaja = 'abierta';
const poolFalso = {
  async query(sql, params) {
    llamadas.push({ sql, params });
    if (/^SELECT estado FROM deshuese/.test(sql)) return [[{ estado: estadoDeshuese }]];
    if (/AS deshuese_estado/.test(sql)) return [[{ deshuese_estado: estadoDeshuese }]];
    if (/^SELECT estado FROM cajas/.test(sql)) return [[{ estado: estadoCaja }]];
    if (/COUNT\(\*\) as c, COALESCE/.test(sql)) return [[{ c: 0, t: 0 }]];
    if (/^\s*(UPDATE|DELETE|INSERT)/.test(sql)) return [{ affectedRows: 1, insertId: 9 }];
    return [[{ id: 1 }]];
  },
  async getConnection() { throw new Error('no usado'); },
};
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
app.use('/api/primales', [authMiddleware, soloLecturaViewer], require('../src/routes/primales'));
app.use('/api/cajas', [authMiddleware, soloLecturaViewer], require('../src/routes/cajas'));

let base;
let server;
test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => new Promise((ok) => server.close(ok)));
test.beforeEach(() => { llamadas.length = 0; estadoDeshuese = 'cerrado'; estadoCaja = 'abierta'; });

const token = (rol) => jwt.sign({ id: 1, rol }, JWT_SECRET, { expiresIn: '5m' });
async function pedir(metodo, ruta, rol, body) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token(rol)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
}
const escrituras = () => llamadas.filter(l => /^\s*(UPDATE|DELETE|INSERT)/.test(l.sql));
const PRIMAL = { codigo: 'P-1', deshuese_id: 1, animal_id: 1, tipo_primal: 'Lomo', peso_kg: 5 };

test('primales: operador no agrega, edita peso ni borra en un deshuese cerrado', async () => {
  assert.equal(await pedir('POST', '/primales', 'operador', PRIMAL), 403);
  assert.equal(await pedir('PUT', '/primales/1', 'operador', { peso_kg: 3 }), 403);
  assert.equal(await pedir('DELETE', '/primales/1', 'operador'), 403);
  assert.equal(escrituras().length, 0);
});

test('primales: con deshuese cerrado el operador sí mueve y congela (flujo posterior)', async () => {
  assert.equal(await pedir('PUT', '/primales/1', 'operador', { estado: 'en_custodia', bodega_actual_id: 2 }), 200);
  assert.equal(await pedir('POST', '/primales/1/congelar', 'operador'), 200);
});

test('primales: admin sí agrega y borra en un deshuese cerrado', async () => {
  assert.equal(await pedir('POST', '/primales', 'admin', PRIMAL), 201);
  assert.equal(await pedir('DELETE', '/primales/1', 'admin'), 200);
});

test('primales: con el deshuese abierto el operador trabaja normal', async () => {
  estadoDeshuese = 'abierto';
  assert.equal(await pedir('POST', '/primales', 'operador', PRIMAL), 201);
  assert.equal(await pedir('PUT', '/primales/1', 'operador', { peso_kg: 3 }), 200);
  assert.equal(await pedir('DELETE', '/primales/1', 'operador'), 200);
});

test('cajas: PUT no acepta despachada ni devuelta', async () => {
  assert.equal(await pedir('PUT', '/cajas/1', 'admin', { estado: 'despachada' }), 400);
  assert.equal(await pedir('PUT', '/cajas/1', 'admin', { estado: 'devuelta' }), 400);
  assert.equal(escrituras().length, 0);
});

test('cajas: una caja despachada o devuelta no cambia de estado por PUT', async () => {
  for (const actual of ['despachada', 'devuelta']) {
    estadoCaja = actual;
    assert.equal(await pedir('PUT', '/cajas/1', 'admin', { estado: 'abierta' }), 409);
  }
  assert.equal(escrituras().length, 0);
  // Las notas sí se pueden corregir.
  assert.equal(await pedir('PUT', '/cajas/1', 'admin', { notas: 'ok' }), 200);
});

test('cajas: abierta/completa por PUT siguen funcionando', async () => {
  assert.equal(await pedir('PUT', '/cajas/1', 'operador', { estado: 'completa' }), 200);
  const u = escrituras().find(l => /^UPDATE `cajas`/.test(l.sql));
  assert.equal(u.sql, 'UPDATE `cajas` SET `estado` = ? WHERE `id` = ?');
});

test('ids no numéricos: 400 sin SQL', async () => {
  assert.equal(await pedir('PUT', '/cajas/1%2F..', 'admin', { notas: 'x' }), 400);
  assert.equal(await pedir('DELETE', '/primales/abc', 'admin'), 400);
  assert.equal(llamadas.length, 0);
});
