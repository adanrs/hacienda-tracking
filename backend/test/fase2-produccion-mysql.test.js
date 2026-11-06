// Fase 2 contra MySQL 8 real (se salta sin TEST_MYSQL_HOST). Cómo correrla:
//   TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=33061 node --test test/fase2-produccion-mysql.test.js
// Cubre: reporte de producción por animal (2 PDF + lista lote → arete, 348MLF → 438MLF confirmado a
// mano, lote sin animal, re-importar = sin cambios, solicitud «con reporte»), catálogo (importar
// listado, alta, 99 pendiente y reasignación), trazabilidad recuperada de una caja «xxx», selección
// múltiple de transporte y sacrificio, y el Excel de la planta con más de 5 canales.
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
const pdf = (n) => ({ buffer: fs.readFileSync(path.join(FIX, n)), nombre: n });
const ARETES = ['F2A225', 'F2A438', 'F2A081', 'F2X001', 'F2X002', 'F2X003', 'F2X004', 'F2X005', 'F2X006', 'F2X007'];
const FECHA_SACR = '2026-10-15';
const MAPA = '2 F2A225\n3 F2A348\n4 F2A081\nBuenas tardes';

test('MySQL real: fase 2 (reporte de producción, catálogo, trazabilidad, lotes)', opciones, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const motor = require('../src/lib/importador/motor');
  const catalogoCortes = require('../src/lib/catalogoCortes');
  const { decodificar } = require('../src/lib/etiquetas');
  const { recuperarPorReporte } = require('../src/lib/trazabilidadEtiqueta');
  t.after(() => pool.end());
  await initDB();
  await initDB(); // idempotente

  // Limpieza de corridas anteriores.
  const [prev] = await pool.query(`SELECT id FROM animales WHERE numero_trazabilidad IN (?)`, [ARETES]);
  await pool.query("DELETE FROM reporte_produccion WHERE fecha_produccion IN ('2026-10-19','2025-11-06','2025-06-11')");
  await pool.query("DELETE FROM lotes_cc_aretes WHERE fecha_deshuese IN ('2026-10-19','2025-11-06','2025-06-11')");
  await pool.query('DELETE FROM solicitudes_deshuese WHERE fecha_sacrificio = ?', [FECHA_SACR]);
  if (prev.length) await pool.query('DELETE FROM animales WHERE id IN (?)', [prev.map((p) => p.id)]);
  await pool.query("DELETE FROM catalogo_cortes WHERE codigo IN ('88801','88802','88803')");
  await pool.query("DELETE FROM catalogo_cortes_bitacora WHERE codigo IN ('88801','88802','88803')");
  const [[u]] = await pool.query('SELECT id FROM usuarios ORDER BY id LIMIT 1');
  const usuarioId = u ? u.id : null;

  // Catálogo: el 99 sembrado, 11163/22229 como trimming y el decodificador leyendo la base.
  const [[p99]] = await pool.query("SELECT nombre, tipo FROM catalogo_cortes WHERE codigo = '99'");
  assert.equal(p99.nombre, 'Corte pendiente de codificar');
  const [tr] = await pool.query("SELECT codigo, tipo FROM catalogo_cortes WHERE codigo IN ('11163','22229') ORDER BY codigo");
  assert.deepEqual(tr.map((x) => x.tipo), ['trimming', 'trimming']);
  assert.equal(catalogoCortes.buscar('22229').origen, 'base');

  // Animales sacrificados el 15-oct (la guía ya está validada en el PR anterior: aquí basta el sacrificio).
  const ids = {};
  for (const [i, a] of ARETES.entries()) {
    const [r] = await pool.query("INSERT INTO animales (numero_trazabilidad, sexo, tipo, estado, padre_numero) VALUES (?, 'macho', 'bovino', 'sacrificado', 'TORO1')", [a]);
    ids[a] = r.insertId;
    const canal = a === 'F2A081' ? 300 : 380; // 081 con 300 kg → el lote 4 no viene; 225 da 92 % (aviso)
    await pool.query("INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, numero_canal) VALUES (?, ?, 600, ?, ?)",
      [r.insertId, `${FECHA_SACR} 00:00:00`, canal, String(7100 + i)]);
  }
  // 225 con canal 380 → 350.82/380 = 92.3 % (aviso de varios animales).

  // Solicitud enviada con los dos primeros animales → al cargar sus reportes pasa a «con reporte».
  const [sol] = await pool.query("INSERT INTO solicitudes_deshuese (numero, fecha_sacrificio, estado) SELECT COALESCE(MAX(numero),0)+1, ?, 'enviada' FROM solicitudes_deshuese", [FECHA_SACR]);
  const [sacs] = await pool.query('SELECT id, animal_id FROM sacrificios WHERE animal_id IN (?, ?)', [ids.F2A225, ids.F2A438]);
  for (const [i, s] of sacs.entries()) await pool.query('INSERT INTO solicitud_canales (solicitud_id, sacrificio_id, orden) VALUES (?, ?, ?)', [sol.insertId, s.id, i + 1]);

  // 1. Vista previa: dos PDF + la lista. 348 no está: propuesta 438 (error hasta confirmar).
  const entrada = { archivos: [pdf('reporte-produccion-lote-02.pdf'), pdf('reporte-produccion-lote-03.pdf')] };
  let plan = await motor.planificar(pool, 'reporte-produccion-ciisa', entrada, { mapa: MAPA });
  assert.equal(plan.filas.length, 2);
  const l2 = plan.filas.find((f) => f.num_lote === '2');
  const l3 = plan.filas.find((f) => f.num_lote === '3');
  assert.equal(l2.accion, 'nuevo');
  assert.equal(l2.arete, 'F2A225');
  assert.equal(l2.kilos, 350.82);
  assert.equal(l2.cajas, 31);
  assert.equal(l2.rendimiento, 92.32);
  assert.match(l2.avisos.join(' '), /varios animales/);
  assert.equal(l2.vencimiento, '2027-10-19');
  assert.equal(l3.accion, 'error');
  assert.equal(l3.correccion.propuesto, 'F2A438');
  assert.ok(plan.faltantes.some((x) => x.lote === '4'));

  // 2. Confirmar a mano la corrección y aplicar.
  const ops = { mapa: MAPA, correcciones: { 3: 'F2A438' } };
  plan = await motor.planificar(pool, 'reporte-produccion-ciisa', entrada, ops);
  assert.equal(plan.resumen.errores, 0);
  assert.equal(plan.trazabilidad.pct, 100);
  const r = await motor.aplicar(pool, 'reporte-produccion-ciisa', entrada, ops, { usuarioId, huella: plan.huella });
  assert.equal(r.resultado.resumen.reportes_nuevos, 2);
  assert.equal(r.resultado.resumen.deshueses, 2);
  assert.equal(r.resultado.resumen.solicitudes_con_reporte, 1);
  const [[est]] = await pool.query('SELECT estado FROM solicitudes_deshuese WHERE id = ?', [sol.insertId]);
  assert.equal(est.estado, 'con_reporte');
  const [[rp]] = await pool.query("SELECT origen, pie_kilos, pdf_url FROM reporte_produccion WHERE fecha_produccion = '2026-10-19' AND lote_cc = 2");
  assert.equal(rp.origen, 'pdf');
  assert.equal(Number(rp.pie_kilos), 350.82);
  assert.ok(fs.existsSync(path.join(__dirname, '..', rp.pdf_url)));

  // 3. Re-importar la misma tanda: sin cambios (no duplica).
  plan = await motor.planificar(pool, 'reporte-produccion-ciisa', entrada, ops);
  assert.equal(plan.resumen.sin_cambios, 2);

  // 4. Lote sin animal: texto pegado con lote 9 que no está en la lista → importable sin trazabilidad.
  const textoL9 = fs.readFileSync(path.join(FIX, 'reporte-produccion-lote-02.pdf'), 'latin1') && [
    'REPORTE DIARIO DE PRODUCCION', 'Fecha de Produccion: 19/10/26', 'Num. Lote 9 Tipo Produccion: TEMPISQUE', 'Lote CC 09',
    '88801 CORTE NUEVO PLANTA 10.00 KGS 1', '21231 DELMONICO 5.00 KGS 1',
    'Total de Cajas por el Lote # 9 Libras 33.07 Kilos 15.00 2'].join('\n');
  plan = await motor.planificar(pool, 'reporte-produccion-ciisa', { pegado: { texto: textoL9 } }, { mapa: MAPA });
  const l9 = plan.filas[0];
  assert.equal(l9.accion, 'error'); // 88801 no está en el catálogo
  assert.deepEqual(l9.codigos_desconocidos.map((c) => c.codigo), ['88801']);
  const ops9 = { mapa: MAPA, pendientes: { 88801: true } };
  plan = await motor.planificar(pool, 'reporte-produccion-ciisa', { pegado: { texto: textoL9 } }, ops9);
  assert.equal(plan.filas[0].accion, 'nuevo');
  assert.equal(plan.filas[0].trazabilidad, 'sin_trazabilidad');
  assert.equal(plan.trazabilidad.pct, 0);
  await motor.aplicar(pool, 'reporte-produccion-ciisa', { pegado: { texto: textoL9 } }, ops9, { usuarioId, huella: plan.huella });

  // 5. Pendientes de codificar: aparece 88801 en 99 y se reasigna al código real recién creado.
  const [[pend]] = await pool.query("SELECT COUNT(*) AS n FROM reporte_produccion_lineas WHERE articulo_codigo = '99' AND codigo_informado = '88801'");
  assert.equal(pend.n, 1);
  await pool.query("INSERT INTO catalogo_cortes (codigo, nombre, tipo) VALUES ('88801', 'Corte nuevo planta', 'subprimal')");
  const [up] = await pool.query("UPDATE reporte_produccion_lineas SET articulo_codigo = '88801', codigo_informado = '' WHERE articulo_codigo = '99' AND codigo_informado = '88801'");
  assert.equal(up.affectedRows, 1);

  // 6. Importar el listado del catálogo: nuevo / cambia / sin cambios / error.
  const listado = 'codigo\tdescripcion\ttipo\n88802\tHueso de prueba\thueso\n88801\tCorte nuevo planta (renombrado)\tsubprimal\n21231\tDelmonico\t\n12\tMalo\t';
  const pc = await motor.planificar(pool, 'catalogo-cortes', { pegado: { texto: listado } });
  assert.deepEqual(pc.filas.map((f) => f.accion), ['nuevo', 'actualizar', pc.filas[2].accion, 'error']);
  await motor.aplicar(pool, 'catalogo-cortes', { pegado: { texto: listado } }, {}, { usuarioId, huella: pc.huella });
  const [[h]] = await pool.query("SELECT tipo FROM catalogo_cortes WHERE codigo = '88802'");
  assert.equal(h.tipo, 'hueso');
  const [[bit]] = await pool.query("SELECT COUNT(*) AS n FROM catalogo_cortes_bitacora WHERE codigo IN ('88801','88802') AND origen = 'importacion'");
  assert.equal(bit.n, 2);
  assert.equal(catalogoCortes.buscar('88802').nombre, 'Hueso de prueba'); // caché recargado

  // 7. Trazabilidad recuperada: caja real «2661700874xxx061125003511» = 06/11/25 + lote de deshuese 0035.
  await pool.query("INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, origen) VALUES ('2025-11-06', 35, '35', 'manual')");
  await pool.query("INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id) VALUES ('2025-11-06', 35, 'F2X001', ?)", [ids.F2X001]);
  const caja = decodificar('2661700874xxx061125003511');
  assert.equal(caja.tipo, 'caja');
  assert.equal(caja.campos.trazabilidad, 'sin_trazabilidad');
  assert.equal(caja.campos.loteDeshuese, 35);
  assert.equal(caja.campos.fechaVencimiento, '2026-11-06');
  let rec = await recuperarPorReporte(pool, caja);
  assert.equal(rec.estado, 'recuperada');
  assert.equal(rec.arete, 'F2X001');
  // La otra lectura de la fecha (MMDDAA = 11/06/25) NO se usa: la caja es DDMMAA fija.
  await pool.query("INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, origen) VALUES ('2025-06-11', 35, '35', 'manual')");
  await pool.query("INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id) VALUES ('2025-06-11', 35, 'F2X002', ?)", [ids.F2X002]);
  rec = await recuperarPorReporte(pool, caja);
  assert.equal(rec.estado, 'recuperada');
  assert.equal(rec.arete, 'F2X001');
  // Se compara SOLO el Num. Lote: un reporte con Lote CC 35 pero Num. Lote 9 no calza.
  await pool.query("INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, origen) VALUES ('2025-11-06', 9, '35', 'manual')");
  await pool.query("INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id) VALUES ('2025-11-06', 9, 'F2X003', ?)", [ids.F2X003]);
  // Ambiguo: dos reportes del 06/11/25 con Num. Lote 35 → nunca se liga solo, con la lista de candidatos.
  rec = await recuperarPorReporte(pool, caja);
  assert.equal(rec.estado, 'sin_trazabilidad');
  assert.match(rec.motivo, /Ambiguo/);
  assert.deepEqual(rec.candidatos.map((c) => c.arete).sort(), ['F2X001', 'F2X003']);

  // 7b. Un arete ya cargado para el lote no se pisa sin confirmar.
  await pool.query("UPDATE lotes_cc_aretes SET arete = 'F2X009', animal_id = NULL WHERE fecha_deshuese = '2026-10-19' AND lote_cc = 2");
  await pool.query("DELETE FROM reporte_produccion WHERE fecha_produccion = '2026-10-19' AND lote_cc = 2");
  const soloL2 = { archivos: [pdf('reporte-produccion-lote-02.pdf')] };
  plan = await motor.planificar(pool, 'reporte-produccion-ciisa', soloL2, { mapa: MAPA });
  assert.equal(plan.filas[0].accion, 'error');
  assert.deepEqual(plan.filas[0].cambio_arete, { antes: 'F2X009', despues: 'F2A225' });
  plan = await motor.planificar(pool, 'reporte-produccion-ciisa', soloL2, { mapa: MAPA, reemplazar_arete: { 2: true } });
  assert.equal(plan.filas[0].accion, 'nuevo');
  assert.ok(plan.discrepancias.some((d) => /estaba cargado con F2X009/.test(d)));

  // 8. Excel para la planta con 7 canales: dos hojas, fórmulas intactas.
  const { llenarPlantilla } = require('../src/lib/solicitudDeshuesePlantilla');
  const canales = ARETES.slice(3).map((a, i) => ({ sacrificio_id: i + 1, arete: a, sexo: 'macho', padre_numero: 'TORO1', peso_vivo: 600, peso_canal: 380, numero_canal: String(7103 + i), marmoleo: 5 }));
  const libro = await llenarPlantilla({ fecha_sacrificio: FECHA_SACR, canales, cortes: [{ codigo: '21231', medias: Object.fromEntries(canales.map((c) => [c.sacrificio_id, 2])) }] });
  assert.deepEqual(libro.worksheets.map((w) => w.name), ['Deshuese 151026', 'Deshuese 151026 (2)']);
  assert.equal(libro.worksheets[1].getCell('G3').value, 'F2X006');
  assert.equal(libro.worksheets[1].getCell('G11').value.formula, 'G8*84%');

  // 9. Solicitud histórica con la plantilla real: 22101 viene dos veces (Lomito y Lomito cabeza) y
  // no debe chocar con la llave única (antes salía un ER_DUP_ENTRY disfrazado de «reintente»).
  await pool.query('DELETE FROM solicitudes_deshuese WHERE fecha_sacrificio = ?', [FECHA_SACR]);
  const [sacsReal] = await pool.query("SELECT s.id, s.numero_canal, a.numero_trazabilidad FROM sacrificios s JOIN animales a ON a.id = s.animal_id WHERE a.numero_trazabilidad IN ('F2X001','F2X002') ORDER BY a.numero_trazabilidad");
  const canalesReal = sacsReal.map((s) => ({ sacrificio_id: s.id, arete: s.numero_trazabilidad, sexo: 'macho', numero_canal: s.numero_canal, peso_canal: 380 }));
  const medias = (v) => Object.fromEntries(canalesReal.map((c) => [c.sacrificio_id, v]));
  const libroReal = await llenarPlantilla({ fecha_sacrificio: FECHA_SACR, canales: canalesReal, cortes: [
    { codigo: '22101', medias: medias(2) }, { codigo: '21231', medias: medias(2) }, { codigo: '22428', medias: medias(0) },
  ] });
  const buf = Buffer.from(await libroReal.xlsx.writeBuffer());
  const entradaReal = { archivos: [{ buffer: buf, nombre: 'solicitud-real.xlsx' }] };
  const ph = await motor.planificar(pool, 'solicitud-deshuese-excel', entradaReal, {});
  assert.equal(ph.filas.length, 1);
  assert.equal(ph.filas[0].accion, 'nuevo', ph.filas[0].errores.join(' | '));
  assert.equal(ph.filas[0].canales_ligadas, 2);
  assert.match(ph.filas[0].avisos.join(' '), /22101/);
  const rh = await motor.aplicar(pool, 'solicitud-deshuese-excel', entradaReal, {}, { usuarioId, huella: ph.huella });
  assert.equal(rh.resultado.resumen.solicitudes, 1);
  const [lom] = await pool.query("SELECT DISTINCT corte_informado FROM solicitud_lineas WHERE solicitud_id = (SELECT id FROM solicitudes_deshuese WHERE fecha_sacrificio = ?) AND corte_codigo = '22101' ORDER BY corte_informado", [FECHA_SACR]);
  assert.deepEqual(lom.map((x) => x.corte_informado), ['Lomito', 'Lomito (Cabeza)']);
});
