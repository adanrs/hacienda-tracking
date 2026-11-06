// Importador contra MySQL 8 real (se salta sin TEST_MYSQL_HOST). Cómo correrla:
//   docker run -d --name ht-mysql-test -e MYSQL_ROOT_PASSWORD=rootlocal -e MYSQL_DATABASE=hacienda_tracking \
//     -e MYSQL_USER=hacienda_admin -e MYSQL_PASSWORD=hacienda_pass -p 33061:3306 mysql:8.0
//   TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=33061 node --test test/importador-mysql.test.js
// Verifica el flujo completo: Ganadero SG (plan → aplicar → re-importar sin duplicar), la guía de
// transporte del día, y el correo de sacrificio de CIISA contra esa guía (177NFU → 177MFU).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.TEST_MYSQL_HOST;
const opciones = { skip: !HOST && 'sin TEST_MYSQL_HOST: prueba de MySQL real omitida' };
if (HOST) {
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = process.env.TEST_MYSQL_PORT || '3306';
  process.env.DB_USER = process.env.TEST_MYSQL_USER || 'hacienda_admin';
  process.env.DB_PASSWORD = process.env.TEST_MYSQL_PASSWORD || 'hacienda_pass';
  process.env.DB_NAME = process.env.TEST_MYSQL_DB || 'hacienda_tracking';
}

const FIX = path.join(__dirname, 'fixtures');
const archivo = (nombre) => ({ archivo: { buffer: fs.readFileSync(path.join(FIX, nombre)), nombre } });
const ARETES = ['225MLE', '33FLE', '438MLF', '710FLF', '81FLB', '177MFU', '900XYZ', '901XYZ', '902XYZ'];

test('MySQL real: Ganadero SG → guía de transporte → sacrificio CIISA', opciones, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const motor = require('../src/lib/importador/motor');
  t.after(() => pool.end());
  await initDB();
  await initDB(); // migración idempotente

  // Limpieza de corridas anteriores (solo los aretes de la prueba).
  const [prev] = await pool.query(`SELECT id FROM animales WHERE numero_trazabilidad IN (${ARETES.map(() => '?').join(',')})`, ARETES);
  if (prev.length) {
    const ids = prev.map(p => p.id);
    await pool.query(`DELETE FROM guias_transporte WHERE id IN (SELECT guia_id FROM guia_transporte_animales WHERE animal_id IN (${ids.map(() => '?').join(',')}))`, ids);
    await pool.query(`DELETE FROM animales WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  }
  await pool.query("DELETE FROM potreros WHERE nombre IN ('PDR','P-NUEVO')");
  const [[u]] = await pool.query("SELECT id FROM usuarios ORDER BY id LIMIT 1");
  const usuarioId = u ? u.id : null;

  // 1. Vista previa: no escribe nada.
  const plan = await motor.planificar(pool, 'ganadero-sg', archivo('ganadero-sg-salidas.xlsx'));
  const [[antes]] = await pool.query('SELECT COUNT(*) AS n FROM animales');
  assert.equal(plan.resumen.total, 11);
  assert.equal(plan.resumen.nuevos, 7); // 5 de la captura + 177MFU + 902XYZ
  assert.equal(plan.resumen.errores, 4); // número vacío, fecha imposible, peso 7000, número repetido
  const err = (fila) => plan.filas.find(f => f.fila === fila).errores.join(' | ');
  assert.match(err(17), /Número \(arete\) vacío/);
  assert.match(err(18), /no es una fecha válida/);
  assert.match(err(19), /fuera de rango/);
  assert.match(err(21), /repetido/);
  assert.match(plan.filas.find(f => f.fila === 20).avisos.join(), /raza desconocida «XYZ»/);
  assert.equal(plan.guias.length, 1);
  assert.equal(plan.guias[0].total_animales, 6);
  assert.equal(plan.guias[0].peso_total_kg, 660 + 714 + 766 + 618 + 748 + 760);
  assert.deepEqual(plan.potreros_nuevos.sort(), ['P-NUEVO', 'PDR']);
  const [[despues]] = await pool.query('SELECT COUNT(*) AS n FROM animales');
  assert.equal(despues.n, antes.n);

  // 2. Aplicar con una huella vieja → 409; con la correcta → aplica todo en una transacción.
  await assert.rejects(motor.aplicar(pool, 'ganadero-sg', archivo('ganadero-sg-salidas.xlsx'), {}, { usuarioId, huella: 'x' }), e => e.status === 409);
  const r = await motor.aplicar(pool, 'ganadero-sg', archivo('ganadero-sg-salidas.xlsx'), {}, { usuarioId, huella: plan.huella });
  assert.equal(r.resultado.resumen.animales_nuevos, 7);
  assert.equal(r.resultado.guias.length, 1);
  assert.match(r.resultado.guias[0].numero, /^GT-20261015-\d{3}$/);

  const [[a]] = await pool.query("SELECT * , DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fn FROM animales WHERE numero_trazabilidad = '225MLE'");
  assert.equal(a.identificacion_electronica, 'A0020000188000001057859');
  assert.equal(a.madre_numero, '225LEZ');
  assert.equal(a.padre_numero, 'PG89');
  assert.equal(a.fn, '2024-03-14');
  assert.equal(a.finca, '01-003 - ENGORDE WAGYU');
  assert.equal(Number(a.peso_actual), 660);
  const [pes] = await pool.query("SELECT tipo, DATE_FORMAT(fecha, '%Y-%m-%d') AS f, peso_kg FROM pesajes WHERE animal_id = ?", [a.id]);
  assert.deepEqual(pes.map(p => [p.tipo, p.f, Number(p.peso_kg)]), [['venta', '2026-10-15', 660]]);
  const [vac] = await pool.query("SELECT producto FROM eventos_salud WHERE animal_id = ? AND tipo = 'vacunacion'", [a.id]);
  assert.deepEqual(vac.map(v => v.producto), ['CLOSTRIDIOS']);
  const [[g]] = await pool.query('SELECT * FROM guias_transporte WHERE id = ?', [r.resultado.guias[0].id]);
  assert.equal(g.total_animales, 6);
  assert.equal(Number(g.peso_total_kg), 4266);
  assert.equal(g.comprador, 'EQTBL RECIPROC');
  const [[tr]] = await pool.query("SELECT COUNT(*) AS n FROM transporte WHERE guia_id = ? AND tipo = 'matadero'", [g.id]);
  assert.equal(tr.n, 6);
  const [[imp]] = await pool.query('SELECT COUNT(*) AS n FROM importaciones_bitacora WHERE importacion_id = ?', [r.importacion_id]);
  assert.ok(imp.n >= 20);
  // 902XYZ (sin salida): U.Peso como pesaje rutinario con la fecha «Actualizado a».
  const [p902] = await pool.query("SELECT p.tipo, DATE_FORMAT(p.fecha, '%Y-%m-%d') AS f FROM pesajes p JOIN animales a ON a.id = p.animal_id WHERE a.numero_trazabilidad = '902XYZ'");
  assert.deepEqual(p902.map(p => [p.tipo, p.f]), [['rutinario', '2026-10-15']]);

  // 3. Re-importar el mismo archivo: nada nuevo, nada duplicado.
  const plan2 = await motor.planificar(pool, 'ganadero-sg', archivo('ganadero-sg-salidas.xlsx'));
  assert.equal(plan2.resumen.nuevos, 0);
  assert.equal(plan2.resumen.actualizados, 0);
  assert.equal(plan2.resumen.sin_cambios, 7);
  assert.equal(plan2.guias[0].accion, 'sin_cambios');
  await motor.aplicar(pool, 'ganadero-sg', archivo('ganadero-sg-salidas.xlsx'), {}, { usuarioId, huella: plan2.huella });
  const [[cuenta]] = await pool.query("SELECT (SELECT COUNT(*) FROM pesajes p JOIN animales a ON a.id = p.animal_id WHERE a.numero_trazabilidad = '225MLE') AS p, (SELECT COUNT(*) FROM guias_transporte WHERE fecha_salida = '2026-10-15') AS g, (SELECT COUNT(*) FROM transporte WHERE guia_id = ?) AS t", [g.id]);
  assert.deepEqual({ ...cuenta }, { p: 1, g: 1, t: 6 });

  // 4. Sacrificio CIISA (.eml): 177NFU no está en la guía → se propone 177MFU.
  //    La propuesta NO se liga sola: la fila queda en error hasta que el usuario la confirma.
  const ps0 = await motor.planificar(pool, 'sacrificio-ciisa', archivo('sacrificio-wagyu-15-10-26.eml'));
  assert.equal(ps0.fecha_sacrificio, '2026-10-15');
  const sinConfirmar = ps0.filas.find(f => f.numero_canal === '5259');
  assert.equal(sinConfirmar.accion, 'error');
  assert.deepEqual(sinConfirmar.correccion, { informado: '177NFU', propuesto: '177MFU', distancia: 1 });
  assert.match(sinConfirmar.errores.join(), /Confírmelo/);
  assert.match(ps0.reporte_planta, /177NFU.*177MFU/);
  const OPC = { correcciones: { [sinConfirmar.fila]: '177MFU' } };
  const ps = await motor.planificar(pool, 'sacrificio-ciisa', archivo('sacrificio-wagyu-15-10-26.eml'), OPC);
  assert.equal(ps.resumen.errores, 0);
  const f4 = ps.filas.find(f => f.numero_canal === '5259');
  assert.equal(f4.arete, '177MFU');
  assert.equal(f4.correccion.confirmado, true);
  assert.match(ps.reporte_planta, /177NFU.*177MFU/);
  assert.equal(ps.filas.find(f => f.numero_canal === '5256').merma_pct, 4.85); // 660 → 628
  assert.deepEqual(ps.pendientes, []);
  const rs = await motor.aplicar(pool, 'sacrificio-ciisa', archivo('sacrificio-wagyu-15-10-26.eml'), OPC, { usuarioId, huella: ps.huella });
  assert.equal(rs.resultado.resumen.sacrificios_nuevos, 6);
  const [[s]] = await pool.query("SELECT s.*, DATE_FORMAT(s.fecha_dia, '%Y-%m-%d') AS dia FROM sacrificios s JOIN animales a ON a.id = s.animal_id WHERE a.numero_trazabilidad = '177MFU'");
  assert.equal(s.numero_canal, '5259');
  assert.equal(s.dia, '2026-10-15');
  assert.equal(Number(s.peso_vivo), 732);
  assert.equal(Number(s.rendimiento_canal), 59.97);
  assert.equal(s.grasa, 2);
  assert.equal(s.golpe, null);
  assert.equal(s.guia_id, g.id);
  const [[est]] = await pool.query("SELECT estado FROM animales WHERE numero_trazabilidad = '177MFU'");
  assert.equal(est.estado, 'sacrificado');
  const [[gs]] = await pool.query('SELECT estado FROM guias_transporte WHERE id = ?', [g.id]);
  assert.equal(gs.estado, 'recibida');

  // 5. Re-importar el correo (ahora como .msg): sin duplicados, todo «sin cambios»/actualizar.
  const ps2 = await motor.planificar(pool, 'sacrificio-ciisa', archivo('sacrificio-wagyu-15-10-26.msg'), OPC);
  assert.equal(ps2.resumen.nuevos, 0);
  assert.equal(ps2.resumen.errores, 0);
  await motor.aplicar(pool, 'sacrificio-ciisa', archivo('sacrificio-wagyu-15-10-26.msg'), OPC, { usuarioId, huella: ps2.huella });
  const [[ns]] = await pool.query('SELECT COUNT(*) AS n FROM sacrificios WHERE guia_id = ?', [g.id]);
  assert.equal(ns.n, 6);

  // 6. Un pegado con un arete sin parecido, sexo distinto y una canal repetida.
  const texto = ['Cantidad\tNúmero de canal\tSexo\tPeso pie (kg)\tPeso canal (kg)\tRendimiento %\tArete\tMusculo\tDientes\tGrasa\tGolpe',
    '1\t5256\tH\t628\t378.5\t61\t225MLE\t1\t4\t3\t-',
    '2\t5256\tM\t740\t460\t62.16\tZZZ999\t1\t4\t3\t-'].join('\n');
  const p3 = await motor.planificar(pool, 'sacrificio-ciisa', { pegado: { texto } }, { fecha_sacrificio: '2026-10-15' });
  assert.match(p3.filas[0].avisos.join(), /prevalece la guía/);
  assert.match(p3.filas[0].avisos.join(), /Rendimiento informado 61/);
  assert.match(p3.filas[1].errores.join(), /repetida/);
  assert.match(p3.filas[1].errores.join(), /ZZZ999 no está/);
});
