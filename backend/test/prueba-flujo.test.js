// Seed de PRUEBA del flujo completo contra MySQL 8 real (se salta sin TEST_MYSQL_HOST). Cómo correrla:
//   docker run -d --name ht-mysql-test -e MYSQL_ROOT_PASSWORD=rootlocal -e MYSQL_DATABASE=hacienda_tracking \
//     -e MYSQL_USER=hacienda_admin -e MYSQL_PASSWORD=hacienda_pass -p 33061:3306 mysql:8.0
//   TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=33061 node --test test/prueba-flujo.test.js
// Verifica: (1) sembrar dos veces no duplica nada; (2) la cadena traza: cada caja del inventario 107
// llega al arete PRUEBA por fecha + lote, con BMS = marmoleo de la canal (no el sufijo); (3) borrar deja cero filas
// PRUEBA y un segundo borrado no falla; (4) ni el seed ni el borrado tocan datos que no son de prueba.
//
// Una sola initDB (no dos): el seed deja una carga del inventario 107 viva mientras corre y la
// prueba de inventario-ciisa compara «la carga anterior» por id; cuanto antes termine esta, menos
// se cruzan cuando node --test corre los archivos en paralelo.
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

// Arete «real» de la prueba (4): no es un marcador PRUEBA y tiene que sobrevivir a todo.
const ARETE_REAL = 'REALPF1';
const MARMOLEO_CANAL = 7; // = MARMOLEO del seed (DMs AUS-MEAT de la canal PRUEBA)

// Las dos pruebas comparten el pool del módulo database: se cierra una sola vez, al final.
if (HOST) test.after(() => require('../src/models/database').pool.end());

test('MySQL real: seed de PRUEBA del flujo completo (idempotente, traza, se borra solo lo suyo)', opciones, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const { sembrarPruebaFlujo, ARETE, ARCHIVO, LOTE, MARCA, GUIA, LOTE_DESHUESE_APP, LOTE_SACRIFICIO } = require('../src/seeds/prueba-flujo');
  const { borrarPruebaFlujo } = require('../src/seeds/borrar-prueba-flujo');
  const { decodificar } = require('../src/lib/etiquetas');
  const { vencimientoDe } = require('../src/lib/vencimiento');
  await initDB();

  // Filas PRUEBA por tabla, contadas SOLO por los marcadores (lo mismo que usa el borrado).
  const contar = async () => {
    const q = async (sql, params) => Number((await pool.query(sql, params))[0][0].n);
    return {
      animales: await q('SELECT COUNT(*) AS n FROM animales WHERE numero_trazabilidad = ?', [ARETE]),
      guias: await q('SELECT COUNT(*) AS n FROM guias_transporte WHERE numero = ?', [GUIA]),
      guia_animales: await q('SELECT COUNT(*) AS n FROM guia_transporte_animales x JOIN guias_transporte g ON g.id = x.guia_id WHERE g.numero = ?', [GUIA]),
      transporte: await q('SELECT COUNT(*) AS n FROM transporte WHERE guia_movilizacion = ?', [GUIA]),
      sacrificios: await q('SELECT COUNT(*) AS n FROM sacrificios WHERE lote_sacrificio = ?', [LOTE_SACRIFICIO]),
      solicitudes: await q('SELECT COUNT(*) AS n FROM solicitudes_deshuese WHERE observaciones = ?', [MARCA]),
      solicitud_canales: await q('SELECT COUNT(*) AS n FROM solicitud_canales c JOIN solicitudes_deshuese s ON s.id = c.solicitud_id WHERE s.observaciones = ?', [MARCA]),
      solicitud_lineas: await q('SELECT COUNT(*) AS n FROM solicitud_lineas l JOIN solicitudes_deshuese s ON s.id = l.solicitud_id WHERE s.observaciones = ?', [MARCA]),
      deshuese: await q('SELECT COUNT(*) AS n FROM deshuese WHERE numero_lote = ?', [LOTE_DESHUESE_APP]),
      reportes: await q('SELECT COUNT(*) AS n FROM reporte_produccion WHERE lote_cc = ? AND num_lote = ?', [LOTE, String(LOTE)]),
      reporte_lineas: await q('SELECT COUNT(*) AS n FROM reporte_produccion_lineas l JOIN reporte_produccion r ON r.id = l.reporte_id WHERE r.lote_cc = ?', [LOTE]),
      lotes_cc_aretes: await q('SELECT COUNT(*) AS n FROM lotes_cc_aretes WHERE lote_cc = ? AND arete = ?', [LOTE, ARETE]),
      escaneos: await q('SELECT COUNT(*) AS n FROM reporte_produccion_escaneos WHERE lote_cc = ?', [LOTE]),
      cargas: await q('SELECT COUNT(*) AS n FROM inventario_planta_cargas WHERE archivo = ?', [ARCHIVO]),
      lineas: await q('SELECT COUNT(*) AS n FROM inventario_planta_lineas l JOIN inventario_planta_cargas c ON c.id = l.carga_id WHERE c.archivo = ?', [ARCHIVO]),
    };
  };

  // Punto de partida limpio (de corridas anteriores) y una fila «real» en las mismas tablas.
  await borrarPruebaFlujo(pool);
  await pool.query('DELETE FROM animales WHERE numero_trazabilidad = ?', [ARETE_REAL]);
  const [an] = await pool.query("INSERT INTO animales (numero_trazabilidad, tipo, sexo, estado, notas) VALUES (?, 'bovino', 'macho', 'sacrificado', 'dato real')", [ARETE_REAL]);
  const realId = an.insertId;
  t.after(() => pool.query('DELETE FROM animales WHERE numero_trazabilidad = ?', [ARETE_REAL]));

  // 1. Dos corridas: la segunda no crea nada y los conteos no cambian.
  const r1 = await sembrarPruebaFlujo(pool);
  const c1 = await contar();
  assert.deepEqual(c1, {
    animales: 1, guias: 1, guia_animales: 1, transporte: 1, sacrificios: 1, solicitudes: 1, solicitud_canales: 1,
    solicitud_lineas: 4, deshuese: 1, reportes: 1, reporte_lineas: 4, lotes_cc_aretes: 1, escaneos: 4, cargas: 1, lineas: 4,
  });
  assert.ok(r1.creados.includes('animal') && r1.creados.includes('inventario_carga'));
  const r2 = await sembrarPruebaFlujo(pool);
  assert.deepEqual(r2.creados, []);
  assert.deepEqual(await contar(), c1);
  assert.deepEqual(r2.ids, r1.ids);
  assert.deepEqual(r2.fechas, r1.fechas);

  // 2. La cadena encadena: caja del 107 → (fecha + lote) → reporte → lote CC → arete → animal → sacrificio.
  const { fechas, ids } = r1;
  assert.ok(fechas.guia < fechas.sacrificio && fechas.sacrificio < fechas.deshuese);
  assert.equal(r1.cajas.length, 4);
  for (const caja of r1.cajas) {
    const d = decodificar(caja.codigo_barras);
    assert.equal(d.tipo, 'caja', caja.codigo_barras);
    assert.deepEqual(d.errores, [], caja.codigo_barras);
    assert.equal(d.campos.fecha, fechas.deshuese);
    assert.equal(d.campos.loteDeshuese, LOTE);
    assert.equal(caja.codigo_barras.length, 25);
    assert.equal(caja.bms, MARMOLEO_CANAL, 'BMS de la caja = marmoleo AUS-MEAT del animal');
    assert.ok(['con_arete', 'recuperada'].includes(caja.trazabilidad), caja.trazabilidad);
    assert.equal(caja.arete, ARETE);
    assert.equal(caja.animal_id, ids.animal);
    assert.equal(caja.reporte_id, ids.reporte);
    assert.equal(caja.fecha_vencimiento, vencimientoDe(fechas.deshuese));
  }
  assert.deepEqual(r1.cajas.map((c) => c.trazabilidad).sort(), ['con_arete', 'recuperada', 'recuperada', 'recuperada']);
  assert.ok(r1.cajas.some((c) => c.medida === 'Caja'), 'una caja de producto por unidad (tortas)');
  // El mismo camino con SQL, como lo recorre la trazabilidad: fecha + Num. Lote → arete → sacrificio.
  const [traza] = await pool.query(
    `SELECT l.codigo_barras, a.numero_trazabilidad AS arete, s.marmoleo, s.id AS sacrificio_id, g.numero AS guia
       FROM inventario_planta_lineas l
       JOIN inventario_planta_cargas c ON c.id = l.carga_id
       JOIN reporte_produccion rp ON rp.id = l.reporte_id
       JOIN lotes_cc_aretes la ON la.fecha_deshuese = rp.fecha_produccion AND la.lote_cc = rp.lote_cc
       JOIN animales a ON a.id = la.animal_id
       JOIN sacrificios s ON s.animal_id = a.id
       JOIN guias_transporte g ON g.id = s.guia_id
      WHERE c.archivo = ? AND rp.lote_cc = SUBSTRING(l.codigo_barras, 20, 4) + 0
        AND DATE_FORMAT(rp.fecha_produccion, '%d%m%y') = SUBSTRING(l.codigo_barras, 14, 6)`, [ARCHIVO]);
  assert.equal(traza.length, 4);
  assert.ok(traza.every((x) => x.arete === ARETE && x.sacrificio_id === ids.sacrificio && x.guia === GUIA));
  // BMS de la caja = marmoleo AUS-MEAT de la canal (el sufijo de la caja no se usa).
  assert.ok(traza.every((x) => Number(x.marmoleo) === r1.cajas[0].bms));
  const [[sol]] = await pool.query(
    `SELECT s.estado, DATE_FORMAT(s.fecha_sacrificio, '%Y-%m-%d') AS f FROM solicitudes_deshuese s
       JOIN solicitud_canales sc ON sc.solicitud_id = s.id WHERE sc.sacrificio_id = ?`, [ids.sacrificio]);
  assert.deepEqual(sol, { estado: 'con_reporte', f: fechas.sacrificio });

  // 3. Borrar deja cero filas PRUEBA; un segundo borrado no falla y no borra nada.
  const b1 = await borrarPruebaFlujo(pool);
  assert.equal(b1.animales, 1);
  assert.equal(b1.inventario_planta_cargas, 1);
  const c0 = await contar();
  assert.ok(Object.values(c0).every((n) => n === 0), JSON.stringify(c0));
  const b2 = await borrarPruebaFlujo(pool);
  assert.ok(Object.values(b2).every((n) => n === 0), JSON.stringify(b2));

  // 4. La fila real sigue intacta tras sembrar y borrar.
  const [[real]] = await pool.query('SELECT id, notas, estado FROM animales WHERE numero_trazabilidad = ?', [ARETE_REAL]);
  assert.deepEqual(real, { id: realId, notas: 'dato real', estado: 'sacrificado' });
});

test('MySQL real: el seed no pisa una solicitud de deshuese real del mismo día', opciones, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const { sembrarPruebaFlujo } = require('../src/seeds/prueba-flujo');
  const { borrarPruebaFlujo } = require('../src/seeds/borrar-prueba-flujo');
  await initDB();
  await borrarPruebaFlujo(pool);

  // El día que el seed elegiría (deshuese = hoy CR − 3, sacrificio = deshuese − 2) ya tiene una
  // solicitud real: el seed debe correrse a otro día y dejar la real como estaba.
  const hoy = new Date(Date.now() - 6 * 3600000);
  hoy.setUTCDate(hoy.getUTCDate() - 5);
  const dia = hoy.toISOString().slice(0, 10);
  const [previa] = await pool.query('SELECT id FROM solicitudes_deshuese WHERE fecha_sacrificio = ?', [dia]);
  let realId = previa.length ? previa[0].id : null;
  if (!realId) {
    const [[{ n }]] = await pool.query('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM solicitudes_deshuese');
    const [ins] = await pool.query("INSERT INTO solicitudes_deshuese (numero, fecha_sacrificio, estado, observaciones) VALUES (?, ?, 'borrador', 'dato real')", [n, dia]);
    realId = ins.insertId;
    t.after(() => pool.query('DELETE FROM solicitudes_deshuese WHERE id = ?', [realId]));
  }
  const [[antes]] = await pool.query('SELECT * FROM solicitudes_deshuese WHERE id = ?', [realId]);

  const r = await sembrarPruebaFlujo(pool);
  assert.ok(r.fechas.sacrificio < dia, `sacrificio ${r.fechas.sacrificio} debió correrse antes de ${dia}`);
  await borrarPruebaFlujo(pool);
  const [[despues]] = await pool.query('SELECT * FROM solicitudes_deshuese WHERE id = ?', [realId]);
  assert.deepEqual(despues, antes);
});
