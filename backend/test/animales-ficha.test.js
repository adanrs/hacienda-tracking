// GET /api/animales/:id con una base sin las tablas de la guía MAG / custodia CIISA (migración sin
// correr): la ficha tiene que responder 200 con esas listas vacías, no 500. Cualquier otro error
// de esas consultas sí sigue siendo 500. Pool simulado (no requiere MySQL).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const rutaDb = path.join(__dirname, '../src/models/database.js');
let fallo = null; // código de error que lanzan las consultas de las tablas nuevas
const pool = {
  async query(sql) {
    if (/guia_movilizacion_animales|documentos_custodia/.test(sql)) {
      const e = new Error(`fallo simulado ${fallo}`);
      e.code = fallo;
      throw e;
    }
    if (/FROM animales a\s/.test(sql) && /WHERE a\.id = \?/.test(sql)) return [[{ id: 5, numero_trazabilidad: 'FICHA-1' }]];
    return [[]];
  },
};
require.cache[rutaDb] = { id: rutaDb, filename: rutaDb, loaded: true, exports: { pool } };

const express = require('express');
const app = express();
app.use('/api/animales', require('../src/routes/animales'));

test('ficha del animal: tablas nuevas inexistentes → [] (no 500); otro error → 500', async (t) => {
  const srv = app.listen(0);
  t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}/api/animales/5`;

  fallo = 'ER_NO_SUCH_TABLE';
  const r = await fetch(url);
  assert.equal(r.status, 200);
  const a = await r.json();
  assert.equal(a.numero_trazabilidad, 'FICHA-1');
  assert.deepEqual(a.guias_movilizacion, []);
  assert.deepEqual(a.documentos_custodia, []);

  fallo = 'ER_ACCESS_DENIED_ERROR';
  assert.equal((await fetch(url)).status, 500);
});
