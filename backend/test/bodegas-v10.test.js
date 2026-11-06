// Reglas que separan el flujo viejo (BOD-*) de las bodegas v10 (12, 107, WC-01): lib/bodegasV10.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { errorSiV10, errorBodegasOrdenSalida } = require('../src/lib/bodegasV10');

// id 1 = BOD-DSP (legacy), 2 = 107, 3 = WC-01, 4 = 12
const V10 = { 2: '107', 3: 'WC-01', 4: '12' };
const conn = {
  async query(sql, [ids]) {
    assert.match(sql, /naturaleza IS NOT NULL/);
    return [ids.filter(i => V10[i]).map(i => ({ id: i, codigo: V10[i] }))];
  },
};

test('custodia/entradas: ninguna bodega v10, ni siquiera WC-01', async () => {
  assert.equal(await errorSiV10(conn, [1]), null);
  assert.equal(await errorSiV10(conn, [undefined, '']), null);
  for (const id of [2, 3, 4]) assert.match(await errorSiV10(conn, [String(id)]), /inventario por etiqueta/);
});

test('orden de salida: origen nunca v10, destino solo BOD-* o WC-01, origen ≠ destino', async () => {
  assert.equal(await errorBodegasOrdenSalida(conn, { origen: 1, destino: 3 }), null);
  assert.equal(await errorBodegasOrdenSalida(conn, { origen: 1, destino: null }), null);
  assert.match(await errorBodegasOrdenSalida(conn, { origen: 2, destino: 3 }), /origen 107/);
  assert.match(await errorBodegasOrdenSalida(conn, { origen: 3, destino: null }), /origen WC-01/);
  assert.match(await errorBodegasOrdenSalida(conn, { origen: 1, destino: 4 }), /destino 12/);
  assert.match(await errorBodegasOrdenSalida(conn, { origen: '1', destino: 1 }), /misma/);
});

test('sin la columna naturaleza (migración no aplicada) no bloquea', async () => {
  const sinColumna = { async query() { throw Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' }); } };
  assert.equal(await errorSiV10(sinColumna, [2]), null);
});
