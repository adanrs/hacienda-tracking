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

const DIA = new Date('2026-11-05T16:30:00Z'); // 5-nov-2026 10:30 en Costa Rica

test('serieDiaria cabe en consecutivos.serie VARCHAR(10)', () => {
  assert.deepEqual(serieDiaria('OS', DIA), { serie: 'OS-1105', anio: 2026 });
  assert.deepEqual(serieDiaria('OE', new Date('2027-01-09T15:00:00Z')), { serie: 'OE-0109', anio: 2027 });
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

test('el día del número es el de Costa Rica, no el del TZ del contenedor', async () => {
  // 5-nov 21:30 en CR = 6-nov 03:30 UTC: la orden es del 5.
  const nocheCr = new Date('2026-11-06T03:30:00Z');
  assert.deepEqual(serieDiaria('OS', nocheCr), { serie: 'OS-1105', anio: 2026 });
  assert.equal(await numeroDiario(conexionFalsa(), { prefijo: 'OS', tabla: 'ordenes_salida', fecha: nocheCr }), 'OS-20261105-001');
  // 6-nov 00:10 en CR = 06:10 UTC: ya es del 6.
  assert.deepEqual(serieDiaria('OS', new Date('2026-11-06T06:10:00Z')), { serie: 'OS-1106', anio: 2026 });
  // Fin de año: 31-dic 23:00 en CR (1-ene 05:00 UTC) sigue en el año viejo.
  assert.deepEqual(serieDiaria('OE', new Date('2027-01-01T05:00:00Z')), { serie: 'OE-1231', anio: 2026 });
});

test('numeroDiario no acepta nombres de tabla arbitrarios', async () => {
  await assert.rejects(numeroDiario(conexionFalsa(), { prefijo: 'OS', tabla: 'x; DROP TABLE y', fecha: DIA }), /tabla inválida/);
});
