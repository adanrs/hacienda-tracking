const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filtrarCampos, construirUpdate, construirInsert, normalizarFechaIso, ErrorCampos,
} = require('../src/lib/sqlUpdate');

const PERMITIDAS = ['notas', 'estado', 'peso_entrada'];
const ENUMS = { estado: ['abierto', 'cerrado', 'reabierto'] };

test('arma el UPDATE con identificadores citados y valores por placeholder', () => {
  const r = construirUpdate({
    tabla: 'deshuese', id: 7, body: { notas: 'hola', estado: 'cerrado' }, permitidas: PERMITIDAS, enums: ENUMS,
  });
  assert.equal(r.sql, 'UPDATE `deshuese` SET `notas` = ?, `estado` = ? WHERE `id` = ?');
  assert.deepEqual(r.params, ['hola', 'cerrado', 7]);
});

test('clave con SQL inyectado: 400 (ErrorCampos), no se arma ninguna sentencia', () => {
  const maliciosas = [
    "estado='abierto' WHERE 1=1 -- ",
    "notas = (SELECT password FROM usuarios WHERE rol='admin' LIMIT 1), estado",
    'notas`=1,`estado',
    'notas;DROP TABLE usuarios',
  ];
  for (const clave of maliciosas) {
    assert.throws(
      () => construirUpdate({ tabla: 'deshuese', id: 1, body: { [clave]: 'x' }, permitidas: PERMITIDAS }),
      (err) => err instanceof ErrorCampos && err.status === 400,
      clave
    );
  }
});

test('columnas fuera de la lista blanca se ignoran (asignación masiva)', () => {
  const r = construirUpdate({
    tabla: 'deshuese', id: 1, permitidas: PERMITIDAS,
    // Lo que manda el frontend al editar: la fila completa del GET con columnas de JOIN.
    body: { id: 99, created_at: '2026-01-01', numero_trazabilidad: 'X', sacrificio_id: 3, notas: 'n' },
  });
  assert.equal(r.sql, 'UPDATE `deshuese` SET `notas` = ? WHERE `id` = ?');
  assert.deepEqual(r.ignoradas.sort(), ['created_at', 'id', 'numero_trazabilidad', 'sacrificio_id']);
});

test('sin columnas válidas: 400, salvo permitirVacio', () => {
  assert.throws(
    () => construirUpdate({ tabla: 't', id: 1, body: { otra: 1 }, permitidas: PERMITIDAS }),
    ErrorCampos
  );
  const r = construirUpdate({ tabla: 't', id: 1, body: {}, permitidas: PERMITIDAS, permitirVacio: true });
  assert.equal(r.sql, null);
});

test('ENUM fuera de rango: 400; null y vacío se aceptan', () => {
  assert.throws(
    () => filtrarCampos({ estado: 'borrado' }, { permitidas: PERMITIDAS, enums: ENUMS }),
    ErrorCampos
  );
  const r = filtrarCampos({ estado: '' }, { permitidas: PERMITIDAS, enums: ENUMS });
  assert.deepEqual(r.valores, [null]);
});

test('valores no escalares (objeto/arreglo) se rechazan', () => {
  assert.throws(() => filtrarCampos({ notas: { password: 1 } }, { permitidas: PERMITIDAS }), ErrorCampos);
  assert.throws(() => filtrarCampos({ notas: ['a', 'b'] }, { permitidas: PERMITIDAS }), ErrorCampos);
});

test('body que no es objeto: 400', () => {
  assert.throws(() => filtrarCampos([1, 2], { permitidas: PERMITIDAS }), ErrorCampos);
  assert.throws(() => filtrarCampos(null, { permitidas: PERMITIDAS }), ErrorCampos);
  assert.throws(() => filtrarCampos('x', { permitidas: PERMITIDAS }), ErrorCampos);
});

test('normalizar se aplica por columna', () => {
  const r = filtrarCampos(
    { peso_entrada: 10, notas: '2026-10-01T08:00 nota' },
    { permitidas: PERMITIDAS, normalizar: (c, v) => (c === 'peso_entrada' ? v * 2 : v) }
  );
  assert.deepEqual(r.valores, [20, '2026-10-01T08:00 nota']);
});

test('normalizarFechaIso', () => {
  assert.equal(normalizarFechaIso('2026-10-01T08:30:00.000Z'), '2026-10-01 08:30:00');
  assert.equal(normalizarFechaIso('2026-10-01T08:30'), '2026-10-01 08:30');
  assert.equal(normalizarFechaIso('2026-10-01'), '2026-10-01');
  assert.equal(normalizarFechaIso(5), 5);
});

test('construirInsert cita columnas', () => {
  const r = construirInsert('config_planta', ['nombre', 'activa'], ['X', 1]);
  assert.equal(r.sql, 'INSERT INTO `config_planta` (`nombre`, `activa`) VALUES (?, ?)');
  assert.deepEqual(r.params, ['X', 1]);
});

test('una lista blanca mal definida en el código falla en voz alta', () => {
  assert.throws(() => construirUpdate({ tabla: 't; DROP', id: 1, body: { notas: 1 }, permitidas: ['notas'] }));
  assert.throws(() => filtrarCampos({ notas: 1 }, { permitidas: [] }));
});
