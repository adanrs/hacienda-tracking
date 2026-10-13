// Prueba de punta a punta de PUT/DELETE /api/deshuese con Express real, JWT real y un pool
// de MySQL falso que registra cada sentencia: así se comprueba que una clave maliciosa no
// llega a ejecutar SQL, que el viewer no escribe y que un no-admin no reabre un cerrado.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// ── Pool falso (se inyecta antes de cargar la ruta) ────────────────────────────
const llamadas = [];
let deshueseActual = { id: 1, estado: 'abierto' };
const poolFalso = {
  async query(sql, params) {
    llamadas.push({ sql, params });
    if (/^SELECT (\*|estado) FROM deshuese WHERE id = \?/.test(sql)) {
      return [deshueseActual ? [{ ...deshueseActual }] : []];
    }
    if (/^(UPDATE|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
    if (/^SELECT/.test(sql)) return [[]];
    throw new Error(`SQL inesperado en el test: ${sql}`);
  },
  async getConnection() { throw new Error('no usado en estos tests'); },
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
const deshueseRouter = require('../src/routes/deshuese');

// Mismo encadenado que index.js: autenticado + viewer en solo lectura.
const app = express();
app.use(express.json());
app.use('/api/deshuese', [authMiddleware, soloLecturaViewer], deshueseRouter);

let base;
let server;
test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api/deshuese`;
});
test.after(() => new Promise((ok) => server.close(ok)));
test.beforeEach(() => { llamadas.length = 0; deshueseActual = { id: 1, estado: 'abierto' }; });

const token = (rol) => jwt.sign({ id: 1, username: rol, nombre: rol, rol }, JWT_SECRET, { expiresIn: '5m' });
async function pedir(metodo, ruta, rol, body) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${token(rol)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const updates = () => llamadas.filter(l => /^UPDATE|^DELETE/.test(l.sql));

test('clave que reabre todos los deshueses: 400 y ningún SQL ejecutado', async () => {
  const r = await pedir('PUT', '/1', 'operador', { "estado='abierto' WHERE 1=1 -- ": 'x' });
  assert.equal(r.status, 400);
  assert.equal(llamadas.length, 0);
});

test('clave que filtra el hash del admin: 400 y ningún SQL ejecutado', async () => {
  const clave = "notas = (SELECT password FROM usuarios WHERE rol='admin' LIMIT 1), estado";
  const r = await pedir('PUT', '/1', 'admin', { [clave]: 'abierto' });
  assert.equal(r.status, 400);
  assert.equal(llamadas.length, 0);
});

test('viewer no puede escribir (PUT y DELETE) pero sí leer', async () => {
  assert.equal((await pedir('PUT', '/1', 'viewer', { notas: 'x' })).status, 403);
  assert.equal((await pedir('DELETE', '/1', 'viewer')).status, 403);
  assert.equal(llamadas.length, 0);
  assert.equal((await pedir('GET', '/', 'viewer')).status, 200);
});

test('operador no reabre un deshuese cerrado (ni mandando solo estado)', async () => {
  deshueseActual = { id: 1, estado: 'cerrado' };
  for (const estado of ['abierto', 'reabierto']) {
    const r = await pedir('PUT', '/1', 'operador', { estado });
    assert.equal(r.status, 403);
  }
  assert.equal((await pedir('PUT', '/1', 'operador', { notas: 'cambio' })).status, 403);
  assert.equal((await pedir('DELETE', '/1', 'operador')).status, 403);
  assert.equal(updates().length, 0);
});

test('admin sí reabre un deshuese cerrado', async () => {
  deshueseActual = { id: 1, estado: 'cerrado' };
  const r = await pedir('PUT', '/1', 'admin', { estado: 'reabierto' });
  assert.equal(r.status, 200);
  const [u] = updates();
  assert.equal(u.sql, 'UPDATE `deshuese` SET `estado` = ? WHERE `id` = ?');
  assert.deepEqual(u.params, ['reabierto', '1']);
});

test('edición normal del frontend: solo pasan columnas de la lista blanca', async () => {
  // Así arma el payload Deshuese.jsx: la fila del GET + primales + prorrateo.
  const payload = {
    id: 1, numero_lote: 'DS-1', sacrificio_id: 4, animal_id: 9, fecha: '2026-10-01T14:00:00.000Z',
    peso_entrada: 300.5, responsable: 'Ana', estado: 'abierto', bodega_origen_id: 2, notas: '',
    created_at: '2026-10-01T14:00:00.000Z', updated_at: '2026-10-01T14:00:00.000Z',
    numero_trazabilidad: 'CR-1', animal_nombre: 'Toro', sacrificio_fecha: null, lote_sacrificio: 'L1',
    pdf_url: '/uploads/x.pdf', primales: [{ tipo_primal: 'Lomo', peso_kg: 10 }], prorrateo: true,
  };
  const r = await pedir('PUT', '/1', 'operador', payload);
  assert.equal(r.status, 200);
  const [u] = updates();
  assert.equal(
    u.sql,
    'UPDATE `deshuese` SET `fecha` = ?, `peso_entrada` = ?, `responsable` = ?, `estado` = ?, `bodega_origen_id` = ?, `notas` = ? WHERE `id` = ?'
  );
  assert.deepEqual(u.params, ['2026-10-01 14:00:00', 300.5, 'Ana', 'abierto', 2, null, '1']);
});

test('estado fuera del ENUM: 400', async () => {
  const r = await pedir('PUT', '/1', 'admin', { estado: 'borrado' });
  assert.equal(r.status, 400);
  assert.equal(updates().length, 0);
});

test('deshuese inexistente: 404', async () => {
  deshueseActual = null;
  assert.equal((await pedir('PUT', '/1', 'admin', { notas: 'x' })).status, 404);
});

// ── Path traversal en la subida de PDF ─────────────────────────────────────────
const fs = require('node:fs');
const dirUploads = path.resolve(__dirname, '../uploads/deshuese');

test('id con %2F (path traversal): 400 en PDF, PUT y DELETE, sin SQL', async () => {
  const fd = new FormData();
  fd.append('pdf', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'x.pdf');
  const res = await fetch(`${base}/5%2F..%2F..%2Fx/pdf`, {
    method: 'POST', headers: { Authorization: `Bearer ${token('admin')}` }, body: fd,
  });
  assert.equal(res.status, 400);
  assert.equal((await pedir('PUT', '/5%2F..%2Fx', 'admin', { notas: 'x' })).status, 400);
  assert.equal((await pedir('DELETE', '/1%20OR%201=1', 'admin')).status, 400);
  assert.equal(llamadas.length, 0);
});

test('el nombre del PDF lo genera el servidor (ignora el nombre original)', async () => {
  const fd = new FormData();
  fd.append('pdf', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), '../../evil.pdf');
  const res = await fetch(`${base}/1/pdf`, {
    method: 'POST', headers: { Authorization: `Bearer ${token('admin')}` }, body: fd,
  });
  assert.equal(res.status, 200);
  const u = llamadas.find(l => /^UPDATE deshuese SET pdf_url/.test(l.sql));
  assert.match(u.params[0], /^\/uploads\/deshuese\/1-\d+\.pdf$/);
  const archivo = path.join(dirUploads, path.basename(u.params[0]));
  assert.ok(fs.existsSync(archivo));
  fs.unlinkSync(archivo);
  assert.ok(!fs.existsSync(path.resolve(dirUploads, '../../evil.pdf')));
});
