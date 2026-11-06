// Inventario semanal de la planta CIISA con los DOS libros reales que mandó la planta:
//   test/fixtures/inv-wagyu-10.xlsx         («INV_WAGYU_10»: solo INV GENERAL, con Medida y Vencido)
//   test/fixtures/inv-wagyu-semana-41.xlsx  («INV WAGYU SEMANA 41»: INV GENERAL en mayúsculas + MADURACION)
// 1. Lector puro (sin base): hojas leídas / ignoradas, lectura de etiquetas, totales.
// 2. Plan con un conn falso (siempre corre): ambos completos, con advertencias, sin errores; mismo
//    contenido ya cargado = sin cambios.
// 3. MySQL real (se salta sin TEST_MYSQL_HOST): aplicar, re-aplicar no duplica, trazabilidad
//    recuperada por fecha + lote, consulta y comparación de snapshots. Cómo correrla:
//      TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=33061 node --test test/inventario-ciisa.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.TEST_MYSQL_HOST;
if (HOST) {
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = process.env.TEST_MYSQL_PORT || '3306';
  process.env.DB_USER = process.env.TEST_MYSQL_USER || 'hacienda_admin';
  process.env.DB_PASSWORD = process.env.TEST_MYSQL_PASSWORD || 'hacienda_pass';
  process.env.DB_NAME = process.env.TEST_MYSQL_DB || 'hacienda_tracking';
}

const inv = require('../src/lib/importador/procesadores/inventarioCiisa');
const motor = require('../src/lib/importador/motor');

const FIX = path.join(__dirname, 'fixtures');
const LIBRO_10 = 'inv-wagyu-10.xlsx';
const LIBRO_41 = 'inv-wagyu-semana-41.xlsx';
const entrada = (nombre, como = nombre) => ({ archivo: { buffer: fs.readFileSync(path.join(FIX, nombre)), nombre: como } });

test('lector puro: INV_WAGYU_10 (solo INV GENERAL, con Medida y Vencido)', async () => {
  const r = await inv.leerLibro(fs.readFileSync(path.join(FIX, LIBRO_10)));
  assert.deepEqual(r.hojas.map((h) => [h.tipo, h.lineas.length]), [['general', 1387]]);
  assert.equal(r.ignoradas.length, 37); // 34 TARIMA + 3 TORTAS: vistas parciales, no se suman
  const ls = r.hojas[0].lineas;
  assert.equal(ls.filter((l) => l.errores.length).length, 0);
  assert.equal(ls.filter((l) => l.sin_codigo_barras).length, 132);
  // Vencido = resultado guardado de =I2<TODAY() (1899-12-31 = VERDADERO).
  assert.equal(ls.filter((l) => l.vencido_archivo === true).length, 209);
  const medidas = new Set(ls.map((l) => l.medida));
  assert.deepEqual([...medidas].sort(), ['Caja', 'Kilos', 'UND']);

  // Etiquetas: «xxx» en la caja = sin trazabilidad; 25 dígitos con código F1 = caja (no primal).
  const ev = ls.map((l) => ({ l, e: inv.evaluarEtiqueta(l) }));
  const xxx = ev.filter((x) => x.e.sinArete);
  assert.equal(xxx.length, 1121); // 1043 «XXX» + 78 «000»
  const hamburguesa = ev.find((x) => x.l.codigo_barras === '2663600100000170226010111');
  assert.equal(hamburguesa.e.decodificado.tipo, 'caja');
  assert.equal(hamburguesa.e.decodificado.campoXXX, '000');
  assert.equal(hamburguesa.e.sinArete, true);
  assert.equal(hamburguesa.e.decodificado.arete, undefined, 'nunca el «xxx» como arete');
  // Primales con código Arreo se leen como primal (su puente es fecha MMDDAA + lote de 2 dígitos).
  const primal = ev.find((x) => x.l.codigo_barras === '2113657736001660822243310');
  assert.equal(primal.e.decodificado.tipo, 'primal');
  assert.equal(primal.e.puente.campos.fechaEmpaque, '2024-08-22');
});

test('lector puro: SEMANA 41 (INV GENERAL en mayúsculas + MADURACION)', async () => {
  const r = await inv.leerLibro(fs.readFileSync(path.join(FIX, LIBRO_41)));
  assert.deepEqual(r.hojas.map((h) => [h.tipo, h.lineas.length]), [['general', 1048], ['maduracion', 399]]);
  assert.equal(r.ignoradas.length, 32);
  const todas = r.hojas.flatMap((h) => h.lineas);
  assert.equal(todas.filter((l) => l.errores.length).length, 0);
  const mad = r.hojas[1].lineas[0];
  // 8202644 → «08202644»: 20-ago-2026, n.º de deshuese 44 (vencimiento fresco = +90 días = 18-nov).
  assert.equal(mad.lote, '08202644');
  assert.equal(mad.caja, '52822');
  assert.equal(mad.fecha_vencimiento, '2026-11-18');
  const e = inv.evaluarEtiqueta(mad);
  assert.deepEqual(e.puente.campos, { fechaEmpaque: '2026-08-20', loteDeshuese: 44 });
  assert.equal(r.hojas[1].lineas.filter((l) => l.estatus === 'Facturar Arreo').length, 93);
  // La columna Lote de la planta coincide con el lote de la caja leída del código de barras.
  const caja = r.hojas[0].lineas.find((l) => l.codigo_barras === '2661700446XXX290326003911');
  assert.equal(caja.lote, '2903260039');
  assert.deepEqual(inv.evaluarEtiqueta(caja).avisos, []);
  // Totales: maduración en kg, sin medida = kilos.
  const t = inv.totalesDe(todas.map((l) => ({ ...l, trazabilidad: 'sin_trazabilidad', vencido: false })));
  assert.equal(t.maduracion.piezas, 399);
  assert.equal(t.maduracion.tarimas, 4);
  assert.ok(t.general.kg > 10000);
});

test('lector puro: tabla pegada desde Excel y validación de peso', () => {
  const pegado = [
    'TARIMA\tCODIGO\tDESCRIPCION\tLOTE\tCAJA\tPESO\tFECHA DE VENCIMIENTO FRESCO\tESTATUS',
    '1\t30124\tBEEF OXTAIL/RABO RES\t8202644\t52822\t1.52\t18/11/2026\t',
    '1\t30124\tBEEF OXTAIL/RABO RES\t8202645\t52856\t0\t18/11/2026\tFacturar Arreo',
  ].join('\n');
  const r = inv.leerPegado(pegado);
  assert.equal(r.hojas[0].tipo, 'maduracion');
  const [a, b] = r.hojas[0].lineas;
  assert.equal(a.fecha_vencimiento, '2026-11-18');
  assert.equal(a.lote, '08202644');
  assert.match(b.errores[0], /mayor que 0/);

  const general = inv.leerPegado('Tarima\tLinea\tCod Barra\tCodigo\tDescripción\tPeso\tLote\n3\t1\t2661700446XXX290326003911\t26617\tNEW YORK STEAK\t4,46\t2903260039');
  assert.equal(general.hojas[0].tipo, 'general');
  assert.equal(general.hojas[0].lineas[0].peso, 4.46);
});

test('comparación de snapshots: altas y bajas por código de barras + lote (multiconjunto)', () => {
  const l = (cb, lote) => ({ hoja: 'general', codigo_barras: cb, lote, codigo: cb.slice(0, 5) });
  const antes = inv.agrupar([l('A', '1'), l('A', '1'), l('B', '2')]);
  const ahora = inv.agrupar([l('A', '1'), l('C', '3')]);
  const d = inv.diferencia(ahora, antes);
  assert.deepEqual(d.altas.map((x) => [x.codigo_barras, x.cantidad]), [['C', 1]]);
  assert.deepEqual(d.bajas.map((x) => [x.codigo_barras, x.cantidad]).sort(), [['A', 1], ['B', 1]]);
});

// Conn falso: catálogo sin el 26687, un reporte de producción que respalda la caja «xxx» del lote
// 2903260039 (29-mar-2026, lote 39) y, según `estado.cargado`, el mismo contenido ya cargado.
function connFalso(estado) {
  return {
    async query(sql, params = []) {
      if (/FROM catalogo_cortes WHERE codigo IN/.test(sql)) return [params.filter((c) => c !== '26687').map((codigo) => ({ codigo, activo: 1 }))];
      if (/FROM reporte_produccion rp/.test(sql)) {
        return [params[0] === '2026-03-29' && params[1] === '39' ? [{ reporte_id: 5, fecha_produccion: '2026-03-29', num_lote: '39', lote_cc: 39, arete: 'INV107A', animal_id: 77 }] : []];
      }
      if (/WHERE contenido_sha256 = \?/.test(sql)) return [estado.cargado ? [{ id: 9, fecha_carga: '2026-11-05 10:00' }] : []];
      if (/FROM inventario_planta_cargas (WHERE es_prueba = 0 )?ORDER BY id DESC LIMIT 1/.test(sql)) return [[]];
      // Marmoleo medido (cámara AUS-MEAT) del animal 77 al que traza el lote 39.
      if (/FROM sacrificios s JOIN animales a/.test(sql)) return [params.includes(77) ? [{ animal_id: 77, arete: 'INV107A', marmoleo: 5 }] : []];
      throw new Error(`SQL no esperado en la prueba: ${sql.slice(0, 80)}`);
    },
  };
}

test('plan (conn falso): ambos libros completos con advertencias, sin errores', async () => {
  for (const [libro, esperadas] of [[LIBRO_10, 1387], [LIBRO_41, 1447]]) {
    const plan = await motor.planificar(connFalso({}), 'inventario-ciisa', entrada(libro), {});
    assert.deepEqual(plan.errores_generales, [], libro);
    assert.equal(plan.filas.length, esperadas, libro);
    assert.equal(plan.resumen.errores, 0, libro);
    assert.equal(plan.resumen.nuevos, esperadas, libro);
    assert.ok(plan.resumen.con_avisos >= 826, `${libro}: las cajas «xxx» van con advertencia`);
    // 26687 (carne molida) fuera del catálogo del conn falso → advertencia + lista para el alta rápida.
    assert.ok(plan.codigos_fuera_catalogo.some((c) => c.codigo === '26687'), libro);
    const molida = plan.filas.find((f) => f.codigo === '26687');
    assert.ok(molida.avisos.some((a) => /no está en el catálogo/.test(a)));
    for (const f of plan.filas) assert.notEqual(f.arete, 'XXX');
    assert.ok(plan.totales.general.piezas > 1000);
  }
  const plan41 = await motor.planificar(connFalso({}), 'inventario-ciisa', entrada(LIBRO_41), {});
  const rec = plan41.filas.filter((f) => f.trazabilidad === 'recuperada');
  assert.ok(rec.length > 0);
  assert.ok(rec.every((f) => f.lote === '2903260039' && f.arete === 'INV107A' && f.animal_id === 77));
  assert.ok(rec[0].avisos.some((a) => /Trazabilidad recuperada/.test(a)));
  // BMS de la caja (2 últimos dígitos, «…003911» → 11) guardado en la línea y comparado con el
  // marmoleo del animal: AUS-MEAT 5 contra BMS 11 no es comparable sin tabla de conversión (sin aviso).
  assert.ok(rec.every((f) => f.bms === 11 && f.bms_animal === 5 && f.bms_estado === 'no_comparable'));
  assert.ok(!rec[0].avisos.some((a) => /BMS/.test(a)));
  assert.equal(plan41.totales.general.trazabilidad.recuperada, rec.length);
  assert.equal(plan41.totales.maduracion.piezas, 399);
  // El nombre del archivo no cambia la huella del contenido.
  const otraVez = await motor.planificar(connFalso({}), 'inventario-ciisa', entrada(LIBRO_41, 'copia.xlsx'), {});
  assert.equal(otraVez.contenido, plan41.contenido);
  // Mismo contenido ya cargado → todo «sin cambios».
  const yaCargado = await motor.planificar(connFalso({ cargado: true }), 'inventario-ciisa', entrada(LIBRO_41), {});
  assert.equal(yaCargado.resumen.sin_cambios, 1447);
  assert.equal(yaCargado.carga_existente.id, 9);
  // Fecha del inventario inválida → error general.
  const malaFecha = await motor.planificar(connFalso({}), 'inventario-ciisa', entrada(LIBRO_10), { fecha_inventario: '31/02/2026' });
  assert.equal(malaFecha.errores_generales.length, 1);
});

test('aplicar: carga simultánea del mismo contenido (llave duplicada) = ya cargado, sin 500', async () => {
  const llamadas = [];
  const conn = {
    async query(sql, params = []) {
      llamadas.push(sql);
      if (/^INSERT INTO inventario_planta_cargas/.test(sql.trim())) throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      if (/SELECT id FROM inventario_planta_cargas WHERE contenido_sha256 = \?/.test(sql)) return [[{ id: 42, sha: params[0] }]];
      throw new Error(`SQL no esperado: ${sql.slice(0, 60)}`);
    },
  };
  const bitacora = [];
  const plan = { carga_existente: null, filas: [{ accion: 'nuevo' }], fecha_inventario: null, archivo_nombre: 'x.xlsx', contenido: 'abc',
    totales: {}, hojas_leidas: [], codigos_fuera_catalogo: [], vencido_referencia: '2026-11-05' };
  const r = await inv.aplicar(conn, plan, { importacionId: 1, usuarioId: null, registrar: (...a) => bitacora.push(a) });
  assert.deepEqual(r.resumen, { carga_id: 42, ya_cargado: true, lineas: 0 });
  assert.equal(bitacora[0][3], 'sin_cambios');
  assert.ok(!llamadas.some((q) => /inventario_planta_lineas/.test(q)), 'no inserta líneas');
  // Cualquier otro error sigue subiendo.
  const roto = { async query() { throw Object.assign(new Error('x'), { code: 'ER_LOCK_DEADLOCK' }); } };
  await assert.rejects(inv.aplicar(roto, plan, { importacionId: 1, registrar: () => {} }), /x/);
});

test('MySQL real: aplicar los dos snapshots, re-aplicar no duplica, consulta y comparación', { skip: !HOST && 'sin TEST_MYSQL_HOST: prueba de MySQL real omitida' }, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  t.after(() => pool.end());
  await initDB();
  await initDB(); // idempotente

  // Limpieza: snapshots de estos dos libros y el reporte de producción de la prueba.
  for (const libro of [LIBRO_10, LIBRO_41]) {
    const p = await motor.planificar(pool, 'inventario-ciisa', entrada(libro), {});
    await pool.query('DELETE FROM inventario_planta_cargas WHERE contenido_sha256 = ?', [p.contenido]);
  }
  await pool.query("DELETE FROM reporte_produccion WHERE fecha_produccion = '2026-03-29' AND lote_cc = 39");
  await pool.query("DELETE FROM lotes_cc_aretes WHERE fecha_deshuese = '2026-03-29' AND lote_cc = 39");
  await pool.query("DELETE FROM animales WHERE numero_trazabilidad = 'INV107A'");
  const [an] = await pool.query("INSERT INTO animales (numero_trazabilidad, sexo, tipo, estado) VALUES ('INV107A', 'macho', 'bovino', 'sacrificado')");
  await pool.query("INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, origen) VALUES ('2026-03-29', 39, '39', 'manual')");
  await pool.query("INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id) VALUES ('2026-03-29', 39, 'INV107A', ?)", [an.insertId]);
  const [[u]] = await pool.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
  const usuarioId = u ? u.id : null;

  // 1. INV_WAGYU_10 primero (semana anterior), luego SEMANA 41.
  const plan10 = await motor.planificar(pool, 'inventario-ciisa', entrada(LIBRO_10), { fecha_inventario: '2026-10-01' });
  assert.equal(plan10.resumen.errores, 0);
  const r10 = await motor.aplicar(pool, 'inventario-ciisa', entrada(LIBRO_10), { fecha_inventario: '2026-10-01' }, { usuarioId, huella: plan10.huella });
  assert.equal(r10.resultado.resumen.lineas, 1387);
  const carga10 = r10.resultado.resumen.carga_id;

  const plan41 = await motor.planificar(pool, 'inventario-ciisa', entrada(LIBRO_41), {});
  assert.equal(plan41.comparacion_previa.carga_id, carga10);
  const r41 = await motor.aplicar(pool, 'inventario-ciisa', entrada(LIBRO_41), {}, { usuarioId, huella: plan41.huella });
  assert.equal(r41.resultado.resumen.lineas, 1447);
  const carga41 = r41.resultado.resumen.carga_id;

  // 2. Re-aplicar el mismo libro (aunque cambie el nombre): sin cambios, no duplica.
  const otra = await motor.planificar(pool, 'inventario-ciisa', entrada(LIBRO_41, 'reenviado.xlsx'), {});
  assert.equal(otra.resumen.sin_cambios, 1447);
  assert.equal(otra.carga_existente.id, carga41);
  const r2 = await motor.aplicar(pool, 'inventario-ciisa', entrada(LIBRO_41, 'reenviado.xlsx'), {}, { usuarioId, huella: otra.huella });
  assert.equal(r2.resultado.resumen.ya_cargado, true);
  const [[{ n41 }]] = await pool.query('SELECT COUNT(*) AS n41 FROM inventario_planta_lineas WHERE carga_id = ?', [carga41]);
  assert.equal(Number(n41), 1447);
  const [[{ cargas }]] = await pool.query('SELECT COUNT(*) AS cargas FROM inventario_planta_cargas WHERE id IN (?, ?)', [carga10, carga41]);
  assert.equal(Number(cargas), 2);

  // 3. Lo guardado: trazabilidad recuperada con su arete, «xxx» nunca como arete, maduración.
  const [rec] = await pool.query("SELECT arete, animal_id, lote FROM inventario_planta_lineas WHERE carga_id = ? AND trazabilidad = 'recuperada'", [carga41]);
  assert.ok(rec.length > 0);
  assert.ok(rec.every((x) => x.arete === 'INV107A' && x.animal_id === an.insertId && x.lote === '2903260039'));
  const [[{ conX }]] = await pool.query("SELECT COUNT(*) AS conX FROM inventario_planta_lineas WHERE carga_id IN (?, ?) AND UPPER(arete) LIKE '%X%'", [carga10, carga41]);
  assert.equal(Number(conX), 0);
  const [[m]] = await pool.query("SELECT COUNT(*) AS n, SUM(peso) AS kg FROM inventario_planta_lineas WHERE carga_id = ? AND hoja = 'maduracion'", [carga41]);
  assert.equal(Number(m.n), 399);
  const [[cg]] = await pool.query('SELECT resumen FROM inventario_planta_cargas WHERE id = ?', [carga10]);
  const resumen = typeof cg.resumen === 'string' ? JSON.parse(cg.resumen) : cg.resumen;
  assert.equal(resumen.totales.general.vencidos, 209);

  // 4. Rutas de consulta con Express real (sin JWT: se monta el router directo).
  const express = require('express');
  const app = express();
  app.use('/api/inventario-planta', require('../src/routes/inventario-planta'));
  const srv = app.listen(0);
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}/api/inventario-planta`;
  const get = async (q) => { const r = await fetch(base + q); return { status: r.status, body: await r.json() }; };
  const lineas = await get(`/lineas?carga_id=${carga41}&hoja=maduracion&tarima=2`);
  assert.equal(lineas.status, 200);
  assert.equal(lineas.body.lineas.length, 119);
  const venc = await get(`/lineas?carga_id=${carga10}&vencidos=1`);
  assert.equal(venc.body.lineas.length, 209);
  const traz = await get(`/lineas?carga_id=${carga41}&trazabilidad=recuperada`);
  assert.equal(traz.body.lineas.length, rec.length);
  assert.equal((await get('/lineas?hoja=otra')).status, 400);
  assert.equal((await get('/lineas?carga_id=1%20OR%201')).status, 400);
  const comp = await get(`/comparacion?carga_id=${carga41}`);
  assert.equal(comp.body.anterior.id, carga10);
  assert.ok(comp.body.altas.length > 0 && comp.body.bajas.length > 0);
  const altas = comp.body.altas.reduce((s, x) => s + x.cantidad, 0);
  const bajas = comp.body.bajas.reduce((s, x) => s + x.cantidad, 0);
  assert.equal(1387 - bajas + altas, 1447, 'anterior − bajas + altas = actual');
  assert.equal(altas, plan41.comparacion_previa.altas);
  const cargasLista = await get('/cargas');
  assert.ok(cargasLista.body.some((c) => c.id === carga41 && Number(c.lineas) === 1447));
});
