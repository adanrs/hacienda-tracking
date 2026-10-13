const test = require('node:test');
const assert = require('node:assert/strict');
const { SOLO_DIGITOS } = require('../src/lib/params');

test('solo dígitos pasan como id', () => {
  for (const ok of ['1', '42', '0007', '2147483647']) assert.ok(SOLO_DIGITOS.test(ok), ok);
  for (const malo of ['', 'abc', '5/../x', '5%2F..', '1 OR 1=1', '-1', '1.5', '12345678901', '..', '1\n']) {
    assert.ok(!SOLO_DIGITOS.test(malo), JSON.stringify(malo));
  }
});
