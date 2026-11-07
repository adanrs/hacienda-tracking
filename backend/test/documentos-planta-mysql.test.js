// Guía de movilización del MAG y documentos de custodia CIISA contra MySQL 8 real (se salta sin
// TEST_MYSQL_HOST; cómo levantarlo: ver importador-mysql.test.js). Verifica la migración idempotente,
// aplicar → re-aplicar sin duplicar, el ligue por I.E. y por Lote CC + RES, que un ligue a mano no se
// pisa y que la guía de transporte del día recibe el número oficial.
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

const ARETES = ['DP-GM1', 'DP-GM2', 'DP-TRE'];
const GUIA = 'ZZ9990001';
const guiaTexto = (extra = '') => `SERVICIO NACIONAL DE SALUD ANIMAL\nNo.: ${GUIA}\nFecha: 02/11/2026\nHora: 07:20 a. m.\n`
  + 'Origen: HACIENDA TEMPISQUE S.A.\nEstablecimiento destino: CIISA-EL ARREO-ESTABLECIMIENTO 12 (BOVINOS)\nBovinos: 3\nDIIO\n'
  + `1\t188009990001\tH\tCruza Brahman\n2\t188009990002\tMC\tCruza Wagyu\n3\t188009990003\tH\tCruza Brahman${extra}`;
const treTexto = 'CENTRO INTERNACIONAL DE INVERSIONES S.A\nTRASLADO DE INVENTARIO EN CUSTODIA\nNo.: 999001\n'
  + 'Bodega Origen: 107 EQTB TEMPISQUE\nBodega Destino: 08 PAQUETERIA-MATERIA PRIMA\nFecha: 24-10-2026 16:04:48\n'
  + 'Observaciones: CORTES FINOS LOTE 87 / RES 9187\n22140\tCESINA DE RES LIMPIA CP\tCAJ\t1.00\tKGS\t3.66\n25000\tBCH WAGYU\tCAJ\t2\tKGS\t50.10\nTOTALES\t3\t53.76';

test('MySQL real: guía MAG + custodia CIISA (aplicar, re-aplicar, ligues)', opciones, async (t) => {
  const { pool, initDB } = require('../src/models/database');
  const motor = require('../src/lib/importador/motor');
  t.after(() => pool.end());
  await initDB();
  await initDB(); // migración idempotente

  // Limpieza de corridas anteriores (solo lo de esta prueba).
  await pool.query('DELETE FROM guias_movilizacion WHERE numero = ?', [GUIA]);
  await pool.query("DELETE FROM documentos_custodia WHERE tipo = 'traslado' AND numero = 999001");
  await pool.query("DELETE FROM guias_transporte WHERE numero = 'GT-DP-0001'");
  const [prev] = await pool.query('SELECT id FROM animales WHERE numero_trazabilidad IN (?)', [ARETES]);
  if (prev.length) {
    const ids = prev.map((p) => p.id);
    await pool.query('DELETE FROM guias_transporte WHERE id IN (SELECT guia_id FROM guia_transporte_animales WHERE animal_id IN (?))', [ids]);
    await pool.query('DELETE FROM lotes_cc_aretes WHERE animal_id IN (?)', [ids]);
    await pool.query('DELETE FROM animales WHERE id IN (?)', [ids]);
  }

  const ids = {};
  const ie = { 'DP-GM1': 'A0020000188000009990001', 'DP-GM2': 'A0020000188000009990002', 'DP-TRE': 'A0020000188000009990777' };
  for (const a of ARETES) {
    const [r] = await pool.query("INSERT INTO animales (numero_trazabilidad, sexo, tipo, identificacion_electronica) VALUES (?, 'hembra', 'bovino', ?)", [a, ie[a]]);
    ids[a] = r.insertId;
  }
  // Guía de transporte de la app del mismo día con DP-GM1.
  const [gt] = await pool.query("INSERT INTO guias_transporte (numero, fecha_salida, finca_origen, comprador, total_animales) VALUES ('GT-DP-0001', '2026-11-02', 'DP', 'DP', 1)");
  const [tr] = await pool.query("INSERT INTO transporte (animal_id, tipo, fecha_salida, estado, guia_id) VALUES (?, 'matadero', '2026-11-02', 'en_transito', ?)", [ids['DP-GM1'], gt.insertId]);
  await pool.query("INSERT INTO guia_transporte_animales (guia_id, animal_id, transporte_id, arete) VALUES (?, ?, ?, 'DP-GM1')", [gt.insertId, ids['DP-GM1'], tr.insertId]);

  // ── Guía MAG ──
  const entrada = { pegado: { texto: guiaTexto() } };
  const plan = await motor.planificar(pool, 'guia-movilizacion', entrada);
  assert.equal(plan.guias[0].ligados, 2);
  assert.equal(plan.resumen.sin_animal, 1);
  const r1 = await motor.aplicar(pool, 'guia-movilizacion', entrada, {}, { huella: plan.huella });
  assert.equal(r1.resultado.resumen.guias_nuevas, 1);
  assert.equal(r1.resultado.resumen.animales_ligados, 2);
  const [[g]] = await pool.query('SELECT id, guia_transporte_id FROM guias_movilizacion WHERE numero = ?', [GUIA]);
  assert.equal(g.guia_transporte_id, gt.insertId);
  const [[gtx]] = await pool.query('SELECT guia_movilizacion FROM guias_transporte WHERE id = ?', [gt.insertId]);
  assert.equal(gtx.guia_movilizacion, GUIA);
  const [[trx]] = await pool.query('SELECT guia_movilizacion FROM transporte WHERE id = ?', [tr.insertId]);
  assert.equal(trx.guia_movilizacion, GUIA);

  // Re-aplicar lo mismo: todo sin cambios.
  const plan2 = await motor.planificar(pool, 'guia-movilizacion', entrada);
  assert.equal(plan2.guias[0].accion, 'sin_cambios');
  assert.ok(plan2.filas.every((f) => f.accion === 'sin_cambios'));

  // Ligue a mano del DIIO sin animal; la re-importación (con un DIIO menos) lo respeta.
  await pool.query("UPDATE guia_movilizacion_animales SET animal_id = ?, vinculo = 'manual' WHERE guia_id = ? AND diio = '188009990003'", [ids['DP-TRE'], g.id]);
  const entrada3 = { pegado: { texto: guiaTexto().replace('\n2\t188009990002\tMC\tCruza Wagyu', '') } };
  const plan3 = await motor.planificar(pool, 'guia-movilizacion', entrada3);
  assert.equal(plan3.guias[0].accion, 'actualizar');
  assert.deepEqual(plan3.guias[0].quitar, ['188009990002']);
  await motor.aplicar(pool, 'guia-movilizacion', entrada3, {}, { huella: plan3.huella });
  const [lineas] = await pool.query('SELECT diio, animal_id, vinculo FROM guia_movilizacion_animales WHERE guia_id = ? ORDER BY diio', [g.id]);
  assert.deepEqual(lineas.map((l) => [l.diio, l.animal_id, l.vinculo]), [['188009990001', ids['DP-GM1'], 'automatico'], ['188009990003', ids['DP-TRE'], 'manual']]);

  // ── Custodia CIISA (TRE) ──
  await pool.query("INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id) VALUES ('2026-10-20', 87, 'DP-TRE', ?)", [ids['DP-TRE']]);
  await pool.query("INSERT INTO sacrificios (animal_id, fecha, numero_canal) VALUES (?, '2026-10-19 08:00:00', '9187')", [ids['DP-TRE']]);
  const e2 = { pegado: { texto: treTexto } };
  const pc = await motor.planificar(pool, 'custodia-ciisa', e2);
  assert.equal(pc.documentos[0].animal_id, ids['DP-TRE']);
  assert.deepEqual(pc.documentos[0].avisos, []);
  const rc = await motor.aplicar(pool, 'custodia-ciisa', e2, {}, { huella: pc.huella });
  assert.equal(rc.resultado.resumen.documentos_nuevos, 1);
  const [[doc]] = await pool.query("SELECT id, animal_id, lote_cc, res, total_kg, total_kg_declarado FROM documentos_custodia WHERE tipo = 'traslado' AND numero = 999001");
  assert.equal(doc.animal_id, ids['DP-TRE']);
  assert.equal(Number(doc.total_kg), 53.76);
  const [dl] = await pool.query('SELECT codigo, codigo_equivalente, kg FROM documentos_custodia_lineas WHERE documento_id = ? ORDER BY orden', [doc.id]);
  assert.deepEqual(dl.map((l) => [l.codigo, l.codigo_equivalente, Number(l.kg)]), [['22140', null, 3.66], ['25000', '22229', 50.1]]);
  const pc2 = await motor.planificar(pool, 'custodia-ciisa', e2);
  assert.equal(pc2.documentos[0].accion, 'sin_cambios');

  // LOTE 87 existe pero la RES 9999 no: no se liga por el lote (solo vista previa, nada se escribe).
  const pcRes = await motor.planificar(pool, 'custodia-ciisa', { pegado: { texto: treTexto.replace('No.: 999001', 'No.: 999002').replace('RES 9187', 'RES 9999') } });
  assert.equal(pcRes.documentos[0].animal_id, null);
  assert.match(pcRes.documentos[0].avisos.join(' '), /RES 9999 no aparece en los sacrificios/);
  // Dos lotes en las Observaciones: cubre varios animales → sin animal.
  const pcVarios = await motor.planificar(pool, 'custodia-ciisa', { pegado: { texto: treTexto.replace('No.: 999001', 'No.: 999002').replace('RES 9187', 'RES 9187 Y LOTE 88 / RES 9188') } });
  assert.equal(pcVarios.documentos[0].animal_id, null);
  assert.match(pcVarios.documentos[0].avisos.join(' '), /cubre varios animales/);

  // Bitácora: queda en el historial de importaciones.
  const [[imp]] = await pool.query("SELECT COUNT(*) AS n FROM importaciones_bitacora WHERE importacion_id = ? AND entidad = 'documento_custodia'", [rc.importacion_id]);
  assert.equal(Number(imp.n), 1);

  // Limpieza.
  await pool.query('DELETE FROM guias_movilizacion WHERE numero = ?', [GUIA]);
  await pool.query('DELETE FROM documentos_custodia WHERE id = ?', [doc.id]);
  await pool.query('DELETE FROM guias_transporte WHERE id = ?', [gt.insertId]);
  await pool.query('DELETE FROM lotes_cc_aretes WHERE animal_id IN (?)', [Object.values(ids)]);
  await pool.query('DELETE FROM animales WHERE id IN (?)', [Object.values(ids)]);
});
