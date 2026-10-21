// Solicitud de deshuese: validación pura (medias solo 0/1/2, n.º de canal), peso estimado,
// filtro de cortes, Excel con el acomodo de la hoja, y rutas con Express + JWT reales sobre un
// pool falso que registra el SQL (permisos del viewer, 400/409 y que todo valor vaya por `?`).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const ExcelJS = require('exceljs');

const sd = require('../src/lib/solicitudDeshuese');
const { construirLibroSolicitud } = require('../src/lib/solicitudDeshueseExcel');

const cuerpoValido = () => ({
  fecha_sacrificio: '2026-10-19',
  observaciones: 'Prueba',
  canales: [{ sacrificio_id: 5, numero_canal: '5256' }, { sacrificio_id: 6, numero_canal: ' 5257 ' }],
  lineas: [
    { corte_codigo: '21114', observacion: '0 para BCH', medias: { 5: 0, 6: 2 } },
    { corte_codigo: '22101', medias: { 5: '1', 6: 2 } },
  ],
});

// ── Lógica pura ─────────────────────────────────────────────────────────────

test('validarSolicitud normaliza un cuerpo válido', () => {
  const v = sd.validarSolicitud(cuerpoValido());
  assert.equal(v.fecha, '2026-10-19');
  assert.deepEqual(v.canales.map((c) => c.numero_canal), ['5256', '5257']);
  assert.deepEqual(v.canales.map((c) => c.orden), [1, 2]);
  assert.equal(v.lineas[1].medias.get(5), 1);
  assert.equal(v.lineas[0].observacion, '0 para BCH');
});

test('medias: solo 0, 1 o 2', () => {
  for (const malo of [3, -1, 1.5, '2.0', 'dos', null, true]) {
    const b = cuerpoValido();
    b.lineas[0].medias[5] = malo;
    assert.throws(() => sd.validarSolicitud(b), (e) => e instanceof sd.ErrorValidacion && /0, 1 o 2/.test(e.detalles.join(' ')), `aceptó ${malo}`);
  }
  for (const bueno of [0, 1, 2, '0', '1', '2']) assert.notEqual(sd.parsearMedias(bueno), null);
});

test('la matriz debe venir completa y sin canales ajenas', () => {
  const b = cuerpoValido();
  delete b.lineas[0].medias[6];
  assert.throws(() => sd.validarSolicitud(b), /faltan las medias/);
  const c = cuerpoValido();
  c.lineas[0].medias[99] = 1;
  assert.throws(() => sd.validarSolicitud(c), /no está en las canales/);
});

test('n.º de canal: formato y repetidos', () => {
  const b = cuerpoValido();
  b.canales[1].numero_canal = '5256';
  assert.throws(() => sd.validarSolicitud(b), /repetido/);
  const c = cuerpoValido();
  c.canales[0].numero_canal = "52'; DROP";
  assert.throws(() => sd.validarSolicitud(c), /n.º de canal inválido/);
  const d = cuerpoValido();
  d.canales[0].numero_canal = '';
  assert.equal(sd.validarSolicitud(d).canales[0].numero_canal, null);
});

test('fecha, canales y cortes obligatorios; repetidos rechazados', () => {
  assert.throws(() => sd.validarSolicitud({ ...cuerpoValido(), fecha_sacrificio: '2026-02-30' }), /Fecha/);
  assert.throws(() => sd.validarSolicitud({ ...cuerpoValido(), canales: [] }), /al menos una canal/);
  assert.throws(() => sd.validarSolicitud({ ...cuerpoValido(), lineas: [] }), /al menos un corte/);
  const b = cuerpoValido();
  b.lineas[1].corte_codigo = '21114';
  assert.throws(() => sd.validarSolicitud(b), /repetido/);
});

test('peso de deshuese estimado = 84 % del canal (frío si existe, si no caliente)', () => {
  assert.equal(sd.PCT_DESHUESE_EST, 0.84);
  assert.deepEqual(sd.pesoCanal({ peso_canal_frio: '380.00', peso_canal_caliente: '390.50' }), { kg: 380, origen: 'frio' });
  assert.deepEqual(sd.pesoCanal({ peso_canal_frio: null, peso_canal_caliente: '390.50' }), { kg: 390.5, origen: 'caliente' });
  assert.deepEqual(sd.pesoCanal({}), { kg: null, origen: null });
  assert.equal(sd.pesoDeshueseEstimado(390.5), 328.02);
  assert.equal(sd.pesoDeshueseEstimado(null), null);
});

test('filtro de cortes: activos de planta (ARREO o sin serie), primal u otro', () => {
  const si = [{ activo: 1, tipo: 'primal', serie: 'ARREO' }, { activo: 1, tipo: 'otro', serie: 'ARREO' }, { activo: 1, tipo: 'primal', serie: null }];
  const no = [{ activo: 0, tipo: 'primal', serie: 'ARREO' }, { activo: 1, tipo: 'bch', serie: 'ARREO' }, { activo: 1, tipo: 'retail', serie: 'F1' }, { activo: 1, tipo: 'subproducto', serie: 'ARREO' }];
  si.forEach((c) => assert.equal(sd.corteEnSolicitud(c), true));
  no.forEach((c) => assert.equal(sd.corteEnSolicitud(c), false));
});

test('Excel: encabezado por canal arriba y cortes en filas con las mismas columnas', async () => {
  const modelo = {
    fecha_sacrificio: '2026-10-19',
    pct_deshuese_est: 0.84,
    planta: { nombre: 'PLANTA', marca_comercial: 'MARCA' },
    solicitud: { numero: 7, estado: 'enviada', enviada_en: '2026-10-19 10:00', enviada_a: 'Planta', observaciones: null },
    canales: [
      { sacrificio_id: 5, arete: '72ELF', sexo: 'macho', peso_pie_finca: 690, peso_vivo: 672, peso_canal: 402.3, numero_canal: '5256', peso_deshuese_est: 337.93 },
      { sacrificio_id: 6, arete: '26FLB', sexo: 'hembra', peso_pie_finca: null, peso_vivo: 650, peso_canal: 355.8, numero_canal: '5257', peso_deshuese_est: 298.87 },
    ],
    cortes: [
      { codigo: '21114', nombre: 'Faldilla FLS', namp: '193', observacion: '0 para BCH', medias: { 5: 0, 6: 2 } },
      { codigo: '22101', nombre: 'Lomitos', namp: null, observacion: null, medias: { 5: 1, 6: 2 } },
    ],
  };
  const libro = construirLibroSolicitud(modelo);
  const buf = await libro.xlsx.writeBuffer();
  const leido = new ExcelJS.Workbook();
  await leido.xlsx.load(buf);
  const h = leido.worksheets[0];
  const filas = [];
  h.eachRow((r, n) => { filas[n] = r.values.slice(1); });
  const buscar = (txt) => filas.findIndex((f) => f && f[0] === txt);
  assert.match(String(filas[1][0]), /SOLICITUD DE DESHUESE N.º 7/);
  const fArete = buscar('Arete');
  assert.deepEqual(filas[fArete].slice(3, 5), ['72ELF', '26FLB']);
  assert.deepEqual(filas[buscar('N.º de canal')].slice(3, 5), ['5256', '5257']);
  const fEnc = buscar('Código CIISA');
  assert.ok(fEnc > fArete, 'los cortes van debajo del encabezado por canal');
  assert.deepEqual(filas[fEnc], ['Código CIISA', 'NAMP', 'Corte', '72ELF', '26FLB', 'Observaciones']);
  assert.deepEqual(filas[fEnc + 1], ['21114', '193', 'Faldilla FLS', 0, 2, '0 para BCH']);
  assert.deepEqual(filas[buscar('Total de medias')].slice(3, 5), [1, 4]);
});

// ── Rutas con pool falso ────────────────────────────────────────────────────

const llamadas = [];
const estado = { existeFecha: false, estadoSolicitud: 'borrador', sinNumero: false, ocupado: false, enOtra: false, dupCanal: false, deadlocks: 0 };

async function responder(sql, params) {
  llamadas.push({ sql, params });
  const s = sql.trim();
  if (/^SELECT id FROM solicitudes_deshuese WHERE fecha_sacrificio = \? FOR UPDATE/.test(s)) {
    if (estado.deadlocks > 0) { estado.deadlocks -= 1; throw Object.assign(new Error('Deadlock found'), { code: 'ER_LOCK_DEADLOCK' }); }
    return [estado.existeFecha ? [{ id: 3 }] : []];
  }
  if (/FROM solicitud_canales sc\s+JOIN solicitudes_deshuese o/.test(s)) {
    return [estado.enOtra ? [{ sacrificio_id: 6, arete: 'A6', numero: 2, fecha: '2026-10-18', estado: 'deshuesada' }] : []];
  }
  if (/^INSERT INTO solicitud_canales/.test(s) && estado.dupCanal) {
    throw Object.assign(new Error("Duplicate entry '6' for key 'solicitud_canales.uk_sc_sacrificio'"), { code: 'ER_DUP_ENTRY', sqlMessage: "Duplicate entry '6' for key 'solicitud_canales.uk_sc_sacrificio'" });
  }
  if (/FROM solicitudes_deshuese WHERE id = \? FOR UPDATE/.test(s)) return [[{ id: Number(params[0]), estado: estado.estadoSolicitud, fecha: '2026-10-19' }]];
  if (/AS fecha, s\.peso_canal_caliente/.test(s)) {
    return [params[0].map((id) => ({ id, fecha: '2026-10-19', peso_canal_caliente: '400.00', peso_canal_frio: null, arete: `A${id}` }))];
  }
  if (/^SELECT codigo FROM catalogo_cortes WHERE codigo IN/.test(s)) return [params[0].map((codigo) => ({ codigo }))];
  if (/s\.numero_canal IN \(\?\) AND s\.id NOT IN/.test(s)) return [estado.ocupado ? [{ id: 99, numero_canal: '5256', arete: 'OTRO1' }] : []];
  if (/MAX\(numero\)/.test(s)) return [[{ siguiente: 4 }]];
  if (/^SELECT id, sacrificio_id FROM solicitud_canales/.test(s)) return [[{ id: 50, sacrificio_id: 5 }, { id: 51, sacrificio_id: 6 }]];
  if (/sc\.numero_canal IS NULL OR/.test(s)) return [estado.sinNumero ? [{ arete: 'A6' }] : []];
  if (/^SELECT COUNT\(\*\) AS n FROM solicitud_canales/.test(s)) return [[{ n: 2 }]];
  if (/^(INSERT|UPDATE|DELETE)/.test(s)) return [{ insertId: 10, affectedRows: 1 }];
  if (/FROM solicitudes_deshuese s\s+LEFT JOIN usuarios u ON u\.id = s\.creado_por\s+WHERE s\.id = \?/.test(s)) {
    return [[{ id: Number(params[0]), numero: 4, fecha_sacrificio: '2026-10-19', estado: estado.estadoSolicitud, observaciones: null, enviada_ts: null, enviada_a: null, actualizada_ts: 1790000000, creado_por: 'Admin' }]];
  }
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
app.use('/api/solicitudes-deshuese', [authMiddleware, soloLecturaViewer], require('../src/routes/solicitudes-deshuese'));

let base;
let server;
test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}/api/solicitudes-deshuese`;
});
test.after(() => new Promise((ok) => server.close(ok)));
test.beforeEach(() => {
  llamadas.length = 0;
  Object.assign(estado, { existeFecha: false, estadoSolicitud: 'borrador', sinNumero: false, ocupado: false, enOtra: false, dupCanal: false, deadlocks: 0 });
});

const token = (rol) => jwt.sign({ id: 1, rol }, JWT_SECRET, { expiresIn: '5m' });
async function pedir(metodo, ruta, rol, body) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(rol)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, datos: ct.includes('json') ? await r.json() : null };
}

test('viewer lee pero no escribe', async () => {
  assert.equal((await pedir('GET', '/', 'viewer')).status, 200);
  assert.equal((await pedir('POST', '/', 'viewer', cuerpoValido())).status, 403);
  assert.equal((await pedir('POST', '/3/enviar', 'viewer', {})).status, 403);
  assert.equal((await pedir('DELETE', '/3', 'viewer')).status, 403);
  assert.ok(!llamadas.some((l) => /^(INSERT|UPDATE|DELETE)/.test(String(l.sql).trim())));
});

test('POST con medias = 3 → 400 sin tocar la base', async () => {
  const b = cuerpoValido();
  b.lineas[0].medias[5] = 3;
  const r = await pedir('POST', '/', 'operador', b);
  assert.equal(r.status, 400);
  assert.ok(r.datos.detalles.length);
  assert.equal(llamadas.length, 0);
});

test('POST crea la solicitud con todo por `?`', async () => {
  const b = cuerpoValido();
  b.observaciones = "x'); DROP TABLE sacrificios; --";
  const r = await pedir('POST', '/', 'admin', b);
  assert.equal(r.status, 201);
  assert.ok(llamadas.some((l) => l.sql === 'COMMIT'));
  for (const l of llamadas) assert.ok(!String(l.sql).includes('DROP TABLE'), 'un valor del request terminó en el SQL');
  const lineas = llamadas.find((l) => /INSERT INTO solicitud_lineas/.test(l.sql));
  assert.equal(lineas.params[0].length, 4); // 2 cortes × 2 canales
  assert.deepEqual(lineas.params[0][0], [10, '21114', 50, 0, '0 para BCH', 1]);
});

test('POST de una fecha que ya tiene solicitud → 409 con el id', async () => {
  estado.existeFecha = true;
  const r = await pedir('POST', '/', 'admin', cuerpoValido());
  assert.equal(r.status, 409);
  assert.equal(r.datos.id, 3);
  assert.ok(llamadas.some((l) => l.sql === 'ROLLBACK'));
});

test('n.º de canal que ya tiene otro animal ese día → 400', async () => {
  estado.ocupado = true;
  const r = await pedir('POST', '/', 'admin', cuerpoValido());
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /OTRO1/);
});

test('PUT de una solicitud enviada → 409', async () => {
  estado.estadoSolicitud = 'enviada';
  const r = await pedir('PUT', '/3', 'admin', cuerpoValido());
  assert.equal(r.status, 409);
});

test('enviar exige n.º de canal en todas las canales', async () => {
  estado.sinNumero = true;
  const r = await pedir('POST', '/3/enviar', 'admin', {});
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /A6/);
});

test('ids no numéricos y fecha inválida → 400', async () => {
  assert.equal((await pedir('GET', '/abc', 'admin')).status, 400);
  assert.equal((await pedir('GET', '/por-fecha?fecha=2026-13-01', 'admin')).status, 400);
});

test('animal que ya está en otra solicitud → 400 con número, fecha y estado de la otra', async () => {
  estado.enOtra = true;
  const r = await pedir('POST', '/', 'admin', cuerpoValido());
  assert.equal(r.status, 400);
  assert.match(r.datos.error, /A6 ya está en la solicitud N\.º 2 del 18\/10\/2026 \(deshuesada\)/);
});

test('PUT excluye la propia solicitud al buscar canales en otra', async () => {
  const r = await pedir('PUT', '/3', 'admin', cuerpoValido());
  assert.equal(r.status, 200);
  const q = llamadas.find((l) => /FROM solicitud_canales sc\s+JOIN solicitudes_deshuese o/.test(l.sql));
  assert.equal(q.params[1], 3);
});

test('choque con uk_sc_sacrificio (carrera) → 409 que explica la causa', async () => {
  estado.dupCanal = true;
  const r = await pedir('POST', '/', 'admin', cuerpoValido());
  assert.equal(r.status, 409);
  assert.match(r.datos.error, /otra solicitud de deshuese/);
});

test('POST reintenta una vez ante deadlock', async () => {
  estado.deadlocks = 1;
  assert.equal((await pedir('POST', '/', 'admin', cuerpoValido())).status, 201);
  estado.deadlocks = 2;
  assert.equal((await pedir('POST', '/', 'admin', cuerpoValido())).status, 409);
});
