// Prueba contra un MySQL 8 de verdad (se salta si no hay TEST_MYSQL_HOST). Cómo correrla:
//   docker run -d --name ht-mysql-test -e MYSQL_ROOT_PASSWORD=rootlocal -e MYSQL_DATABASE=hacienda_tracking \
//     -e MYSQL_USER=hacienda_admin -e MYSQL_PASSWORD=hacienda_pass -p 33061:3306 mysql:8.0
//   TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=33061 npm test
// Verifica: initDB dos veces seguidas (idempotente), tablas v10 creadas con la definición
// completa, bodegas y usuario de servicio, y que el consecutivo NO se repite con 30 órdenes
// creadas a la vez en transacciones concurrentes (el caso que rompía COUNT(*)+1).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');

const HOST = process.env.TEST_MYSQL_HOST;
const opciones = { skip: !HOST && 'sin TEST_MYSQL_HOST: prueba de MySQL real omitida' };

if (HOST) {
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = process.env.TEST_MYSQL_PORT || '3306';
  process.env.DB_USER = process.env.TEST_MYSQL_USER || 'hacienda_admin';
  process.env.DB_PASSWORD = process.env.TEST_MYSQL_PASSWORD || 'hacienda_pass';
  process.env.DB_NAME = process.env.TEST_MYSQL_DB || 'hacienda_tracking';
}

test('MySQL real: migración idempotente y consecutivo sin carreras', opciones, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const { numeroDiario } = require('../src/lib/consecutivos');
  t.after(() => pool.end());

  await initDB();
  await initDB(); // segunda vez: no debe fallar ni duplicar nada

  const [tablas] = await pool.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('etiquetas','movimientos_etiqueta','formatos_etiqueta','consecutivos','integracion_eventos')");
  assert.equal(tablas.length, 5);

  const [cols] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'etiquetas'");
  assert.equal(cols[0].n, 35); // 33 de v10 + copia + tienda_pieza_id

  const [bod] = await pool.query("SELECT codigo, naturaleza, ambito_inventario FROM bodegas WHERE codigo IN ('12','107','WC-01') ORDER BY codigo");
  assert.deepEqual(bod.map(b => [b.codigo, b.naturaleza, b.ambito_inventario]),
    [['107', 'virtual', 'custodia'], ['12', 'fisica', 'proceso'], ['WC-01', 'fisica', 'propio']]);
  const [legacy] = await pool.query("SELECT COUNT(*) AS n FROM bodegas WHERE codigo LIKE 'BOD-%'");
  assert.equal(legacy[0].n, 5); // las sembradas siguen

  const [srv] = await pool.query("SELECT rol FROM usuarios WHERE username = 'integracion.tienda'");
  assert.deepEqual(srv.map(u => u.rol), ['servicio']);
  const [fe] = await pool.query('SELECT COUNT(*) AS n FROM formatos_etiqueta');
  assert.equal(fe[0].n, 3);

  // 30 órdenes a la vez, cada una en su transacción, como POST /api/ordenes-salida.
  const fecha = new Date('2031-01-15T15:00:00Z'); // 15-ene-2031 9:00 en CR, día sin órdenes previas
  await pool.query("DELETE FROM ordenes_salida WHERE numero LIKE 'OS-20310115-%'");
  await pool.query("DELETE FROM consecutivos WHERE serie = 'OS-0115' AND anio = 2031");
  const crear = async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const numero = await numeroDiario(conn, { prefijo: 'OS', tabla: 'ordenes_salida', fecha });
      await conn.query("INSERT INTO ordenes_salida (numero, fecha, estado) VALUES (?, NOW(), 'pendiente')", [numero]);
      await conn.commit();
      return numero;
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  };
  const numeros = await Promise.all(Array.from({ length: 30 }, crear));
  assert.equal(new Set(numeros).size, 30);
  assert.deepEqual([...numeros].sort(), Array.from({ length: 30 }, (_, i) => `OS-20310115-${String(i + 1).padStart(3, '0')}`));

  // Un rollback no consume número (sin huecos).
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  await numeroDiario(conn, { prefijo: 'OS', tabla: 'ordenes_salida', fecha });
  await conn.rollback();
  conn.release();
  assert.equal(await crear(), 'OS-20310115-031');
  await pool.query("DELETE FROM ordenes_salida WHERE numero LIKE 'OS-20310115-%'");

  // Idempotencia en la base: el UNIQUE de integracion_eventos.clave.
  await pool.query("DELETE FROM integracion_eventos WHERE clave = 'baja.aplicada:prueba'");
  const fila = ["baja.aplicada:prueba", 'baja.aplicada', 1, 'a'.repeat(64), 'sombra', '{}', '{}'];
  const ins = 'INSERT INTO integracion_eventos (clave, tipo, version_contrato, hash_cuerpo, modo, payload, resultado) VALUES (?, ?, ?, ?, ?, ?, ?)';
  await pool.query(ins, fila);
  await assert.rejects(pool.query(ins, fila), { code: 'ER_DUP_ENTRY' });
  await pool.query("DELETE FROM integracion_eventos WHERE clave = 'baja.aplicada:prueba'");

  // Órdenes de salida por la API real: doble despacho simultáneo, PUT tras despachar y bodegas v10.
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/os', require('../src/routes/ordenes-salida'));
  process.env.INTEGRACION_TIENDA_MODO = 'sombra';
  process.env.INTEGRACION_TIENDA_SECRETO = 'b'.repeat(64);
  const appInt = express();
  appInt.use('/api/integracion/tienda', require('../src/routes/integracion-tienda'));
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  t.after(() => new Promise((ok) => servidor.close(ok)));
  const url = `http://127.0.0.1:${servidor.address().port}/os`;
  const llamar = async (metodo, ruta, cuerpo) => {
    const r = await fetch(url + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo && JSON.stringify(cuerpo) });
    return { status: r.status, body: await r.json() };
  };
  const [bods] = await pool.query("SELECT id, codigo FROM bodegas WHERE codigo IN ('BOD-DSP','BOD-CUS','WC-01','107')");
  const id = Object.fromEntries(bods.map(b => [b.codigo, b.id]));
  // v10: el origen nunca (107 → WC-01 solo se arma desde /api/traslados-tienda); el destino solo WC-01; origen ≠ destino.
  assert.equal((await llamar('POST', '/', { fecha: '2026-11-05', bodega_origen_id: id['107'], bodega_destino_id: id['WC-01'] })).status, 400);
  assert.equal((await llamar('POST', '/', { fecha: '2026-11-05', bodega_origen_id: id['107'], bodega_destino_id: id['BOD-DSP'] })).status, 400);
  assert.equal((await llamar('POST', '/', { fecha: '2026-11-05', bodega_origen_id: id['BOD-DSP'], bodega_destino_id: id['107'] })).status, 400);
  assert.equal((await llamar('POST', '/', { fecha: '2026-11-05', bodega_origen_id: id['BOD-DSP'], bodega_destino_id: id['BOD-DSP'] })).status, 400);
  const orden = await llamar('POST', '/', { fecha: '2026-11-05', bodega_origen_id: id['BOD-DSP'], bodega_destino_id: id['WC-01'] });
  assert.equal(orden.status, 201);
  assert.equal((await llamar('PUT', `/${orden.body.id}`, { bodega_destino_id: id['107'] })).status, 400);
  // Doble clic: dos despachos a la vez → uno 200 y el otro 409, un solo despachada_en.
  const dobles = await Promise.all([llamar('POST', `/${orden.body.id}/despachar`), llamar('POST', `/${orden.body.id}/despachar`)]);
  assert.deepEqual(dobles.map(r => r.status).sort(), [200, 409]);
  // Después del despacho no se cambia ni el estado ni la bodega de destino.
  assert.equal((await llamar('PUT', `/${orden.body.id}`, { estado: 'cancelada' })).status, 409);
  assert.equal((await llamar('PUT', `/${orden.body.id}`, { bodega_destino_id: id['BOD-CUS'] })).status, 409);

  // /despachos con SQL real (CAST + INTERVAL del solapamiento): aparece pasado el asentamiento de
  // 5 s y vuelve a aparecer en la consulta siguiente (relee 60 s; la tienda deduplica por número).
  const { firmar } = require('../src/lib/integracion/firma');
  const srvInt = await new Promise((ok) => { const s = appInt.listen(0, '127.0.0.1', () => ok(s)); });
  t.after(() => new Promise((ok) => srvInt.close(ok)));
  const despachos = async (cursor) => {
    const ruta = `/api/integracion/tienda/despachos${cursor ? `?cursor=${cursor}` : ''}`;
    const fecha = String(Date.now());
    const r = await fetch(`http://127.0.0.1:${srvInt.address().port}${ruta}`, { headers: {
      'X-Integracion-Clave': 'tienda-v1', 'X-Integracion-Fecha': fecha,
      'X-Integracion-Firma': firmar({ secreto: 'b'.repeat(64), fecha, metodo: 'GET', ruta, cuerpo: Buffer.alloc(0) }) } });
    return r.json();
  };
  await new Promise(r => setTimeout(r, 5500));
  const d1 = await despachos();
  assert.ok(d1.despachos.some(d => d.numero === orden.body.numero));
  const d2 = await despachos(d1.siguiente_cursor);
  assert.ok(d2.despachos.some(d => d.numero === orden.body.numero));

  await pool.query('DELETE FROM ordenes_salida WHERE id = ?', [orden.body.id]);

  // Triggers append-only: si se pudieron crear, bloquean UPDATE/DELETE del kardex.
  const [trg] = await pool.query("SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'movimientos_etiqueta'");
  t.diagnostic(`triggers de movimientos_etiqueta: ${trg.map(x => x.n).join(', ') || 'NINGUNO (ver backend/migraciones/)'}`);
});
