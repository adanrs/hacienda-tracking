// Consecutivo de órdenes de salida/entrada (lib/consecutivos.js) con una conexión falsa que
// imita la tabla consecutivos. La concurrencia real (InnoDB) se prueba en
// test/mysql-integracion.test.js contra un MySQL de verdad.
const test = require('node:test');
const assert = require('node:assert/strict');
const { siguienteConsecutivo, numeroDiario, serieDiaria } = require('../src/lib/consecutivos');

function conexionFalsa({ maxExistente = null } = {}) {
  const filas = new Map();
  let ultimoId = 0;
  const sqls = [];
  return {
    sqls,
    filas,
    async query(sql, p = []) {
      sqls.push(sql);
      if (/^SELECT ultimo FROM consecutivos/.test(sql)) {
        const f = filas.get(`${p[0]}|${p[1]}`);
        return [f === undefined ? [] : [{ ultimo: f }]];
      }
      if (/^INSERT INTO consecutivos .* ON DUPLICATE KEY UPDATE ultimo = ultimo/.test(sql)) {
        const k = `${p[0]}|${p[1]}`;
        if (!filas.has(k)) filas.set(k, p[2]);
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE consecutivos SET ultimo = LAST_INSERT_ID\(ultimo \+ 1\)/.test(sql)) {
        const k = `${p[0]}|${p[1]}`;
        ultimoId = filas.get(k) + 1;
        filas.set(k, ultimoId);
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT LAST_INSERT_ID\(\) AS n/.test(sql)) return [[{ n: ultimoId }]];
      if (/SELECT MAX\(CAST\(SUBSTRING\(numero, \?\) AS UNSIGNED\)\) AS m FROM `ordenes_salida` WHERE numero LIKE \?/.test(sql)) {
        assert.equal(p[0], 'OS-20261105-'.length + 1);
        assert.equal(p[1], 'OS-20261105-%');
        return [[{ m: maxExistente }]];
      }
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
}

const DIA = new Date(2026, 10, 5, 10, 30); // 5-nov-2026, hora local

test('serieDiaria cabe en consecutivos.serie VARCHAR(10)', () => {
  assert.deepEqual(serieDiaria('OS', DIA), { serie: 'OS-1105', anio: 2026 });
  assert.deepEqual(serieDiaria('OE', new Date(2027, 0, 9)), { serie: 'OE-0109', anio: 2027 });
  assert.throws(() => serieDiaria('PREFIJOLARGO', DIA), /demasiado larga/);
});

test('numeroDiario: arranca en 001 y sigue sin repetir', async () => {
  const c = conexionFalsa();
  assert.equal(await numeroDiario(c, { prefijo: 'OS', tabla: 'ordenes_salida', fecha: DIA }), 'OS-20261105-001');
  assert.equal(await numeroDiario(c, { prefijo: 'OS', tabla: 'ordenes_salida', fecha: DIA }), 'OS-20261105-002');
  assert.equal(await numeroDiario(c, { prefijo: 'OS', tabla: 'ordenes_salida', fecha: DIA }), 'OS-20261105-003');
  // La semilla (MAX de las órdenes existentes) se consulta una sola vez por serie.
  assert.equal(c.sqls.filter(s => /SELECT MAX/.test(s)).length, 1);
});

test('el día del despliegue continúa después de las órdenes ya creadas con el código viejo', async () => {
  const c = conexionFalsa({ maxExistente: 7 });
  assert.equal(await numeroDiario(c, { prefijo: 'OS', tabla: 'ordenes_salida', fecha: DIA }), 'OS-20261105-008');
});

test('el número sale de UPDATE … LAST_INSERT_ID (atómico), no de COUNT(*)+1', async () => {
  const c = conexionFalsa();
  await siguienteConsecutivo(c, { serie: 'OS-1105', anio: 2026 });
  assert.ok(c.sqls.some(s => /UPDATE consecutivos SET ultimo = LAST_INSERT_ID\(ultimo \+ 1\)/.test(s)));
  assert.ok(!c.sqls.some(s => /COUNT\(\*\)/i.test(s)));
});

test('numeroDiario no acepta nombres de tabla arbitrarios', async () => {
  await assert.rejects(numeroDiario(conexionFalsa(), { prefijo: 'OS', tabla: 'x; DROP TABLE y', fecha: DIA }), /tabla inválida/);
});
