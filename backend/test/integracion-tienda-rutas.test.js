// Rutas /api/integracion/tienda con Express real (montadas como en index.js, antes del
// express.json global) y un pool falso que simula integracion_eventos con su UNIQUE(clave).
// Cubre: rechazo de Cloudflare, interruptor de modo, secreto ausente, firma, idempotencia
// (reenvío idéntico, misma clave con otro contenido, carrera de dos envíos), validación y el
// cursor de despachos. Nunca hay escrituras de inventario: solo integracion_eventos.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const vectores = require('./fixtures/integracion-firma-vectores.json');
const { firmar } = require('../src/lib/integracion/firma');

const SECRETO = vectores.secreto;
const llamadas = [];
const eventos = new Map(); // clave → fila
const estado = { carrera: false, sinUsuario: false, solapes: [] };
const dup = () => Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });

// Paquete de 28 real (test/etiquetas.test.js): arete 34GKAE, artículo 26632, 0,416 kg.
const PAQ = '34GKAE266322309243300416F101';
// Cajas CIISA de 25 reales (test/etiquetas.test.js) que terminan en «11».
const CAJA11 = '2661700874XXX061125003511';
const CAJA11_TORTAS = '2664901321XXX290125003911';

async function responder(sql, params = []) {
  llamadas.push({ sql, params });
  const s = sql.replace(/\s+/g, ' ').trim();
  if (/^SELECT id FROM usuarios WHERE username = \?/.test(s)) return [estado.sinUsuario ? [] : [{ id: 99 }]];
  if (/^SELECT hash_cuerpo, resultado(, estado)? FROM integracion_eventos WHERE clave = \?/.test(s)) {
    if (estado.carrera) { estado.carrera = false; return [[]]; } // el otro envío todavía no confirmó
    const f = eventos.get(params[0]);
    return [f ? [{ hash_cuerpo: f.hash, resultado: JSON.parse(f.resultado) }] : []];
  }
  if (/^INSERT INTO integracion_eventos/.test(s)) {
    if (eventos.has(params[0])) throw dup();
    eventos.set(params[0], { hash: params[3], resultado: params[7] });
    return [{ insertId: eventos.size, affectedRows: 1 }];
  }
  if (/FROM etiquetas e LEFT JOIN bodegas b/.test(s)) {
    // Ganadería conoce PAQ disponible en WC-01.
    const pares = params[0];
    return [pares.filter(([c, k]) => c === PAQ && k === 1).map(() => ({ codigo_crudo: PAQ, copia: 1, estado: 'disponible', bodega: 'WC-01' }))];
  }
  if (/^SELECT id FROM bodegas WHERE codigo = 'WC-01'/.test(s)) return [[{ id: 8 }]];
  if (/FROM ordenes_salida o LEFT JOIN bodegas bo/.test(s)) {
    const todas = [
      { id: 3, numero: 'OS-20261105-001', fecha: new Date('2026-11-05T12:00:00Z'), destino: 'Tienda', notas: null, despachada_en: new Date('2026-11-05T15:00:00.120Z'), despachada_txt: '2026-11-05 09:00:00.120000', origen_codigo: '107', origen_nombre: 'Custodia', origen_codigo_ciisa: '107' },
      { id: 4, numero: 'OS-20261105-002', fecha: new Date('2026-11-05T12:00:00Z'), destino: null, notas: 'x', despachada_en: new Date('2026-11-05T15:00:00.120Z'), despachada_txt: '2026-11-05 09:00:00.120000', origen_codigo: '107', origen_nombre: 'Custodia', origen_codigo_ciisa: '107' },
    ];
    const [, t, solape, , , id, limite] = params;
    estado.solapes.push(solape);
    // Con solapamiento (60 s) se relee todo: los dos despachos están en el mismo instante.
    const resto = solape > 0 ? todas : todas.filter(o => o.despachada_txt > t || (o.despachada_txt === t && o.id > id));
    return [resto.slice(0, limite)];
  }
  if (/FROM ordenes_salida_items i/.test(s)) {
    return [[
      { id: 1, orden_id: 3, caja_id: 21, primal_id: null, cantidad: 1, peso_kg: null, caja_codigo: 'CJ-1', caja_tipo_corte: 'NEW YORK', caja_peso_kg: '10.500', primal_codigo: null, tipo_primal: null, primal_peso_kg: null },
      // Cajas CIISA del inventario 107 que terminan en «11» (sufijo, NO el BMS: JC 07-nov-2026). `bms`
      // guardado = 11 como lo dejaban las órdenes armadas antes del fix: no se tiene que usar.
      { id: 2, orden_id: 4, caja_id: null, primal_id: null, cantidad: 1, peso_kg: '8.740', codigo_barras: CAJA11, codigo_articulo: '26617', item_descripcion: 'NEW YORK', lote: '0611250035', bms: 11, arete: 'ANIM06', animal_id: 606 },
      { id: 3, orden_id: 4, caja_id: null, primal_id: null, cantidad: 1, peso_kg: '1.000', codigo_barras: CAJA11_TORTAS, codigo_articulo: '26649', item_descripcion: 'TORTAS', lote: '2901250039', bms: 11, arete: null, animal_id: null },
    ]];
  }
  // Marmoleo AUS-MEAT medido de la canal del animal 606 (arete ANIM06).
  if (/FROM sacrificios s JOIN animales a/.test(s)) return [params.includes(606) || params.includes('ANIM06') ? [{ animal_id: 606, arete: 'ANIM06', marmoleo: 6 }] : []];
  if (/FROM stickers s/.test(s)) return [[{ caja_id: 21, codigo_barras: PAQ.toLowerCase(), peso_kg: '1.234' }, { caja_id: 21, codigo_barras: 'STK-0001', peso_kg: '0.900' }]];
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
const app = express();
app.use('/api/integracion/tienda', require('../src/routes/integracion-tienda'));
app.use(express.json()); // igual que index.js: el parser global va DESPUÉS

let base;
let server;
test.before(async () => {
  await new Promise((ok) => { server = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise((ok) => server.close(ok)));
test.beforeEach(() => {
  llamadas.length = 0;
  eventos.clear();
  Object.assign(estado, { carrera: false, sinUsuario: false, solapes: [] });
  delete process.env.INTEGRACION_TIENDA_SECRET;
  process.env.INTEGRACION_TIENDA_MODO = 'sombra';
  process.env.INTEGRACION_TIENDA_SECRETO = SECRETO;
});

async function pedir(metodo, ruta, { cuerpo, cabeceras = {}, firma, fecha = String(Date.now()), clave = 'tienda-v1', sinFirma = false } = {}) {
  const texto = cuerpo === undefined ? '' : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
  const h = { 'Content-Type': 'application/json', ...cabeceras };
  if (!sinFirma) {
    h['X-Integracion-Clave'] = clave;
    h['X-Integracion-Fecha'] = fecha;
    h['X-Integracion-Firma'] = firma || firmar({ secreto: SECRETO, fecha, metodo, ruta, cuerpo: Buffer.from(texto) });
  }
  const res = await fetch(base + ruta, { method: metodo, headers: h, body: texto === '' ? undefined : texto });
  const tipo = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: tipo.includes('json') ? await res.json() : await res.text() };
}

const R = '/api/integracion/tienda';
const escrituras = () => llamadas.filter(l => /^\s*(INSERT|UPDATE|DELETE)/.test(l.sql));

const baja = (extra = {}) => ({
  v: 1, clave: 'baja.aplicada:17', tipo: 'baja.aplicada', ocurrido_en: '2026-11-05T15:20:11-06:00',
  origen: { app: 'tienda', usuario: 'panel · admin', ip: null },
  datos: { baja_id: 17, motivo_tienda: 'descarte', motivo_ganaderia: 'descarte', piezas: [{ codigo: PAQ, copia: 1, kg: 0.416 }], nota: 'golpe', aprobada_por: 'admin' },
  ...extra,
});

test('llega por Cloudflare: 404 aunque la firma sea válida y antes de revelar el modo', async () => {
  for (const h of ['cf-ray', 'cf-connecting-ip']) {
    const r = await pedir('GET', `${R}/salud`, { cabeceras: { [h]: '8f00abc-MIA' } });
    assert.equal(r.status, 404, h);
  }
  process.env.INTEGRACION_TIENDA_MODO = 'apagado';
  assert.equal((await pedir('GET', `${R}/salud`, { cabeceras: { 'CF-Connecting-IP': '1.2.3.4' } })).status, 404);
  assert.equal((await pedir('GET', `${R}/salud`, { cabeceras: { 'CDN-Loop': 'cloudflare' } })).status, 404);
});

test('interruptor: apagado (o valor desconocido) responde 503 sin tocar la base', async () => {
  for (const modo of ['apagado', '', 'on']) {
    process.env.INTEGRACION_TIENDA_MODO = modo;
    const r = await pedir('GET', `${R}/salud`);
    assert.equal(r.status, 503, modo);
    assert.equal(r.body.error, 'integracion_apagada');
  }
  assert.equal(llamadas.length, 0);
});

test('sin secreto o con secreto corto: 503 (configuración incompleta)', async () => {
  delete process.env.INTEGRACION_TIENDA_SECRETO;
  assert.equal((await pedir('GET', `${R}/salud`)).status, 503);
  process.env.INTEGRACION_TIENDA_SECRETO = 'corto';
  assert.equal((await pedir('GET', `${R}/salud`)).body.error, 'integracion_sin_configurar');
});

test('INTEGRACION_TIENDA_SECRET (nombre viejo) sigue valiendo como alias', async () => {
  delete process.env.INTEGRACION_TIENDA_SECRETO;
  process.env.INTEGRACION_TIENDA_SECRET = SECRETO;
  assert.equal((await pedir('GET', `${R}/salud`)).status, 200);
});

test('firma: ausente, vencida o de otro cuerpo → 401; válida → salud firmada', async () => {
  assert.equal((await pedir('GET', `${R}/salud`, { sinFirma: true })).status, 401);
  const vieja = String(Date.now() - 6 * 60 * 1000);
  const r1 = await pedir('GET', `${R}/salud`, { fecha: vieja });
  assert.deepEqual([r1.status, r1.body.motivo], [401, 'fecha_fuera_de_ventana']);
  const fecha = String(Date.now());
  const firmaOtro = firmar({ secreto: SECRETO, fecha, metodo: 'POST', ruta: `${R}/eventos`, cuerpo: Buffer.from('{"a":1}') });
  const r2 = await pedir('POST', `${R}/eventos`, { cuerpo: '{"a":2}', fecha, firma: firmaOtro });
  assert.deepEqual([r2.status, r2.body.motivo], [401, 'firma']);
  assert.equal((await pedir('GET', `${R}/salud`, { clave: 'tienda-v7' })).body.motivo, 'clave_desconocida');
  const ok = await pedir('GET', `${R}/salud`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.contrato, '1');
  assert.equal(ok.body.modo, 'sombra');
  assert.equal(escrituras().length, 0);
});

test('sin usuario de servicio: 503', async () => {
  // El id queda en caché tras el primer éxito, así que esta prueba usa un router nuevo.
  delete require.cache[require.resolve('../src/routes/integracion-tienda')];
  const app2 = express();
  app2.use(R, require('../src/routes/integracion-tienda'));
  const srv = await new Promise((ok) => { const s = app2.listen(0, '127.0.0.1', () => ok(s)); });
  estado.sinUsuario = true;
  const fecha = String(Date.now());
  const ruta = `${R}/salud`;
  const res = await fetch(`http://127.0.0.1:${srv.address().port}${ruta}`, { headers: {
    'X-Integracion-Clave': 'tienda-v1', 'X-Integracion-Fecha': fecha,
    'X-Integracion-Firma': firmar({ secreto: SECRETO, fecha, metodo: 'GET', ruta, cuerpo: Buffer.alloc(0) }) } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'integracion_sin_usuario_servicio');
  await new Promise((ok) => srv.close(ok));
});

test('evento válido en sombra: se registra una vez, responde avisos y no mueve inventario', async () => {
  const r = await pedir('POST', `${R}/eventos`, { cuerpo: baja(), cabeceras: { 'Idempotency-Key': 'baja.aplicada:17' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { clave: 'baja.aplicada:17', resultado: 'registrado', modo: 'sombra', aplicado: false, avisos: [] });
  const w = escrituras();
  assert.equal(w.length, 1);
  assert.match(w[0].sql, /INSERT INTO integracion_eventos/);
  assert.ok(llamadas.some(l => l.sql === 'COMMIT'));
});

test('idempotencia: mismo cuerpo dos veces → mismo resultado y una sola escritura', async () => {
  const cuerpo = JSON.stringify(baja());
  const a = await pedir('POST', `${R}/eventos`, { cuerpo });
  const b = await pedir('POST', `${R}/eventos`, { cuerpo });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(b.body, a.body);
  assert.equal(b.headers.get('idempotency-replayed'), 'true');
  assert.equal(escrituras().length, 1);
});

test('idempotencia: misma clave con otro contenido → 409 y no se escribe', async () => {
  await pedir('POST', `${R}/eventos`, { cuerpo: baja() });
  const otra = baja();
  otra.datos.nota = 'otra nota';
  const r = await pedir('POST', `${R}/eventos`, { cuerpo: otra });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'clave_con_otro_contenido');
  assert.equal(escrituras().length, 1);
});

test('idempotencia: dos envíos simultáneos (el UNIQUE gana) → el segundo recibe el guardado', async () => {
  const cuerpo = JSON.stringify(baja());
  await pedir('POST', `${R}/eventos`, { cuerpo });
  estado.carrera = true; // la lectura previa no lo ve; el INSERT choca con ER_DUP_ENTRY
  const r = await pedir('POST', `${R}/eventos`, { cuerpo });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('idempotency-replayed'), 'true');
  assert.ok(llamadas.some(l => l.sql === 'ROLLBACK'));
});

test('evento inválido → 422 (no se reintenta) y no se registra', async () => {
  const casos = [
    ['no es json', 'json_invalido'],
    [{ ...baja(), v: 2 }, 'evento_invalido'],
    [{ ...baja(), clave: 'baja.aplicada:99' }, 'evento_invalido'], // clave no determinista
    [{ ...baja(), tipo: 'toma.aplicada', clave: 'toma.aplicada:1' }, 'evento_invalido'], // fase posterior
    [baja({ datos: { ...baja().datos, motivo_tienda: 'robo' } }), 'evento_invalido'],
    [baja({ datos: { ...baja().datos, motivo_tienda: 'otro', nota: '' } }), 'evento_invalido'],
    [baja({ datos: { ...baja().datos, piezas: [{ codigo: PAQ, kg: 1 }, { codigo: PAQ.toLowerCase(), kg: 1 }] } }), 'evento_invalido'],
  ];
  for (const [cuerpo, error] of casos) {
    const r = await pedir('POST', `${R}/eventos`, { cuerpo });
    assert.equal(r.status, 422, JSON.stringify(cuerpo).slice(0, 80));
    assert.equal(r.body.error, error);
  }
  const r = await pedir('POST', `${R}/eventos`, { cuerpo: baja(), cabeceras: { 'Idempotency-Key': 'otra' } });
  assert.equal(r.status, 422);
  assert.equal(escrituras().length, 0);
});

test('sombra: avisos por etiqueta desconocida, formato y motivo que no coincide', async () => {
  const ev = baja({ datos: { ...baja().datos, motivo_ganaderia: 'ajuste', piezas: [{ codigo: PAQ, kg: 0.416 }, { codigo: 'XX99', kg: 1 }] } });
  const r = await pedir('POST', `${R}/eventos`, { cuerpo: ev });
  assert.equal(r.status, 200);
  const tipos = r.body.avisos.map(a => a.tipo).sort();
  assert.deepEqual(tipos, ['etiqueta_desconocida', 'formato_invalido', 'motivo_no_coincide']);
});

test('venta.salida y traslado.recibido validan su clave por documento', async () => {
  const venta = {
    v: 1, clave: 'venta.salida:WC-261105-1234', tipo: 'venta.salida', ocurrido_en: '2026-11-05T15:20:11-06:00',
    origen: { app: 'tienda' },
    datos: { pedido: 'WC-261105-1234', canal: 'web', salida_en: '2026-11-05T15:20:11-06:00', piezas: [{ codigo: PAQ, copia: 1, kg: 0.416 }], unidades: [] },
  };
  assert.equal((await pedir('POST', `${R}/eventos`, { cuerpo: venta })).status, 200);
  const recibido = {
    v: 1, clave: 'traslado.recibido:5', tipo: 'traslado.recibido', ocurrido_en: '2026-11-05T15:20:11-06:00',
    origen: { app: 'tienda' },
    datos: { numero_orden: 'OS-20261105-001', recepcion_id: 5, cerrada_en: '2026-11-05T15:20:11-06:00',
      cajas: [{ codigo: 'CAJA25', copia: 1, kg_etiqueta: 10.5, paquetes: [{ codigo: PAQ, copia: 1, kg: 0.416 }] }], diferencias: [] },
  };
  const r = await pedir('POST', `${R}/eventos`, { cuerpo: recibido });
  assert.equal(r.status, 200);
  // PAQ ya existe en ganadería: en una recepción eso es un aviso.
  assert.deepEqual(r.body.avisos.map(a => a.tipo), ['etiqueta_ya_existe']);
  const anulada = { ...venta, tipo: 'venta.anulada', clave: 'venta.anulada:WC-261105-1234:1', datos: { pedido: 'WC-261105-1234', piezas: [{ codigo: PAQ }], motivo: 'no salió del camión' } };
  assert.equal((await pedir('POST', `${R}/eventos`, { cuerpo: anulada })).status, 200);
  assert.equal((await pedir('POST', `${R}/eventos`, { cuerpo: { ...anulada, clave: 'venta.anulada:WC-261105-1234' } })).status, 422);
});

test('encendido: 503 hasta que existan los procesadores (no registra como visto)', async () => {
  process.env.INTEGRACION_TIENDA_MODO = 'encendido';
  const r = await pedir('POST', `${R}/eventos`, { cuerpo: baja() });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'procesadores_no_disponibles');
  assert.equal(escrituras().length, 0);
  // Las consultas sí funcionan.
  assert.equal((await pedir('GET', `${R}/salud`)).body.modo, 'encendido');
});

test('despachos: paginado por cursor, con las etiquetas de cada caja', async () => {
  const p1 = await pedir('GET', `${R}/despachos?limite=1`);
  assert.equal(p1.status, 200);
  assert.equal(p1.body.despachos.length, 1);
  assert.equal(p1.body.hay_mas, true);
  const d = p1.body.despachos[0];
  assert.equal(d.numero, 'OS-20261105-001');
  assert.equal(d.origen.codigo, '107');
  assert.equal(d.lineas[0].tipo, 'caja');
  assert.equal(d.lineas[0].kg, 10.5);
  const [ciisa, interna] = d.lineas[0].etiquetas;
  assert.equal(ciisa.codigo, PAQ); // normalizada a mayúsculas
  assert.equal(ciisa.formato, 'ciisa_paquete');
  assert.equal(ciisa.codigo_articulo, '26632');
  assert.equal(interna.formato, 'interno');

  const p2 = await pedir('GET', `${R}/despachos?limite=1&cursor=${p1.body.siguiente_cursor}`);
  assert.deepEqual(p2.body.despachos.map(x => x.numero), ['OS-20261105-002']); // mismo instante, id mayor
  // BMS que viaja a la tienda: el marmoleo del animal (6), nunca el «11» del código ni el guardado.
  const [conAnimal, sinAnimal] = p2.body.despachos[0].lineas;
  assert.equal(conAnimal.formato, 'ciisa_caja');
  assert.equal(conAnimal.bms, 6);
  assert.equal(sinAnimal.codigo, CAJA11_TORTAS);
  assert.equal(sinAnimal.bms, null, 'caja «…11» sin animal con marmoleo → sin BMS');
  assert.equal(p2.body.hay_mas, false);
  // p2 terminó (hay_mas = false): la consulta siguiente relee 60 s hacia atrás y vuelven a salir
  // los dos; la tienda los deduplica por número.
  const p3 = await pedir('GET', `${R}/despachos?cursor=${p2.body.siguiente_cursor}`);
  assert.deepEqual(p3.body.despachos.map(x => x.numero), ['OS-20261105-001', 'OS-20261105-002']);
  assert.deepEqual(estado.solapes, [0, 0, 60]); // entre páginas no se relee
  assert.equal(p3.body.hay_mas, false);

  assert.equal((await pedir('GET', `${R}/despachos?cursor=basura`)).status, 400);
  assert.equal((await pedir('GET', `${R}/despachos?limite=500`)).status, 400);
  // Ningún valor del request va concatenado en el SQL.
  for (const l of llamadas) assert.ok(!/basura|OS-2026/.test(l.sql));
  assert.equal(escrituras().length, 0);
});
