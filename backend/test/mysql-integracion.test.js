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
  const fecha = new Date(2031, 0, 15, 9, 0); // día sin órdenes previas
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

  // Triggers append-only: si se pudieron crear, bloquean UPDATE/DELETE del kardex.
  const [trg] = await pool.query("SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'movimientos_etiqueta'");
  t.diagnostic(`triggers de movimientos_etiqueta: ${trg.map(x => x.n).join(', ') || 'NINGUNO (ver backend/migraciones/)'}`);
});
