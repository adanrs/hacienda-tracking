// Firma HMAC tienda → ganadería: vectores fijos compartidos con wagyu-demo, ventana de tiempo,
// cuerpo alterado, rotación con dos claves y secretos inválidos.
const test = require('node:test');
const assert = require('node:assert/strict');
const vectores = require('./fixtures/integracion-firma-vectores.json');
const { firmar, verificar, cargarClaves, sha256hex, VENTANA_MS } = require('../src/lib/integracion/firma');

const SECRETO = vectores.secreto;
const claves = new Map([['tienda-v1', SECRETO]]);

test('vectores conocidos: misma firma byte a byte que la tienda', () => {
  for (const c of vectores.casos) {
    const cuerpo = Buffer.from(c.cuerpo);
    assert.equal(sha256hex(cuerpo), c.sha256_cuerpo, c.nombre);
    assert.equal(firmar({ secreto: SECRETO, fecha: c.fecha, metodo: c.metodo, ruta: c.ruta, cuerpo }), c.firma, c.nombre);
    const r = verificar({ claves, idClave: 'tienda-v1', fecha: c.fecha, firma: c.firma, metodo: c.metodo, ruta: c.ruta, cuerpo, ahora: Number(c.fecha) });
    assert.deepEqual(r, { ok: true, idClave: 'tienda-v1' }, c.nombre);
  }
});

const caso = vectores.casos.find(c => c.nombre === 'post_evento');
const base = { claves, idClave: 'tienda-v1', fecha: caso.fecha, firma: caso.firma, metodo: 'POST', ruta: caso.ruta, cuerpo: Buffer.from(caso.cuerpo), ahora: Number(caso.fecha) };

test('rechaza fecha fuera de la ventana de ±5 min (y acepta justo en el borde)', () => {
  assert.equal(verificar({ ...base, ahora: Number(caso.fecha) + VENTANA_MS }).ok, true);
  assert.equal(verificar({ ...base, ahora: Number(caso.fecha) - VENTANA_MS }).ok, true);
  assert.deepEqual(verificar({ ...base, ahora: Number(caso.fecha) + VENTANA_MS + 1 }), { ok: false, motivo: 'fecha_fuera_de_ventana' });
  assert.deepEqual(verificar({ ...base, ahora: Number(caso.fecha) - VENTANA_MS - 1 }), { ok: false, motivo: 'fecha_fuera_de_ventana' });
});

test('rechaza cuerpo alterado, otra ruta, otro método o firma ajena', () => {
  assert.equal(verificar({ ...base, cuerpo: Buffer.from(caso.cuerpo.replace('17', '18')) }).motivo, 'firma');
  assert.equal(verificar({ ...base, cuerpo: Buffer.from(caso.cuerpo + ' ') }).motivo, 'firma');
  assert.equal(verificar({ ...base, ruta: '/api/integracion/tienda/eventos?x=1' }).motivo, 'firma');
  assert.equal(verificar({ ...base, metodo: 'PUT' }).motivo, 'firma');
  const otraFirma = firmar({ secreto: 'f'.repeat(64), fecha: caso.fecha, metodo: 'POST', ruta: caso.ruta, cuerpo: base.cuerpo });
  assert.equal(verificar({ ...base, firma: otraFirma }).motivo, 'firma');
  // La firma en mayúsculas es la misma firma (hex no distingue).
  assert.equal(verificar({ ...base, firma: caso.firma.toUpperCase() }).ok, true);
});

test('encabezados faltantes o malformados y clave desconocida', () => {
  assert.equal(verificar({ ...base, firma: undefined }).motivo, 'encabezados');
  assert.equal(verificar({ ...base, fecha: '2026-11-05' }).motivo, 'encabezados');
  assert.equal(verificar({ ...base, firma: 'zz' }).motivo, 'encabezados');
  assert.equal(verificar({ ...base, idClave: 'tienda-v9' }).motivo, 'clave_desconocida');
});

test('rotación: dos claves vigentes a la vez, cada una por su id', () => {
  const nueva = 'abcdef0123456789'.repeat(4);
  const { claves: dos, errores } = cargarClaves(`tienda-v2:${nueva},tienda-v1:${SECRETO}`);
  assert.deepEqual(errores, []);
  assert.equal(dos.size, 2);
  assert.equal(verificar({ ...base, claves: dos }).ok, true); // la vieja sigue valiendo
  const firmaNueva = firmar({ secreto: nueva, fecha: caso.fecha, metodo: 'POST', ruta: caso.ruta, cuerpo: base.cuerpo });
  assert.deepEqual(verificar({ ...base, claves: dos, idClave: 'tienda-v2', firma: firmaNueva }), { ok: true, idClave: 'tienda-v2' });
  // Firmar con la nueva pero anunciar la vieja no pasa.
  assert.equal(verificar({ ...base, claves: dos, idClave: 'tienda-v1', firma: firmaNueva }).motivo, 'firma');
});

test('cargarClaves: secreto solo = tienda-v1; vacío, corto o repetido no se aceptan', () => {
  assert.deepEqual([...cargarClaves(SECRETO).claves.keys()], ['tienda-v1']);
  assert.equal(cargarClaves('').claves.size, 0);
  assert.equal(cargarClaves(undefined).claves.size, 0);
  const corto = cargarClaves('abc123');
  assert.equal(corto.claves.size, 0);
  assert.match(corto.errores[0], /menos de 32/);
  assert.equal(cargarClaves(`${SECRETO},${SECRETO}`).claves.size, 0); // varias sin id
  assert.equal(cargarClaves(`a:${SECRETO},a:${SECRETO}`).claves.size, 1);
  // Los errores nunca incluyen el secreto.
  for (const e of cargarClaves(`x:${'9'.repeat(20)}`).errores) assert.ok(!e.includes('9'.repeat(20)));
});
