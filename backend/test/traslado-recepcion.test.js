// Traslado 107 → tienda (WC-01) y su recepción por caja (Juan Carlos, 06-nov-2026).
//
// 1. compararRecepcion (puro): recibida, faltante, sobrante, otro peso, cajas repetidas.
// 2. MySQL real (se salta sin TEST_MYSQL_HOST): marcar cajas del inventario de la planta → orden →
//    despacho → GET /despachos firmado → POST traslado.recibido firmado con diferencias (encendido)
//    → recepción guardada por caja; reenvío idéntico (idempotente), misma clave con otro contenido
//    (409) y modo «pruebas» con una orden real (422 solo_pruebas).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-solo-para-pruebas-0123456789abcdef';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vectores = require('./fixtures/integracion-firma-vectores.json');
const { compararRecepcion } = require('../src/lib/integracion/procesadorTraslado');
const { firmar } = require('../src/lib/integracion/firma');

// Caja real del ejemplo de JC: 26617 · 8.740 kg · XXX · 06-11-25 · lote 0035 · sufijo 11.
const CAJA_A = '2661700874XXX061125003511';
const CAJA_B = '2661701050XXX061125003511';
const CAJA_C = '2661700990XXX061125003509';
const CAJA_X = '2661700777XXX061125003508'; // no estaba en la orden

test('compararRecepcion: todo llegó con su peso → recibida', () => {
  const r = compararRecepcion(
    [{ id: 1, codigo_barras: CAJA_A, peso_kg: '8.740' }, { id: 2, codigo_barras: CAJA_B, peso_kg: '10.500' }],
    { cajas: [{ codigo: CAJA_A.toLowerCase(), kg_etiqueta: 8.74 }, { codigo: CAJA_B }], diferencias: [] });
  assert.equal(r.estado, 'recibida');
  assert.deepEqual(r.cajas.map(c => c.resultado), ['recibida', 'recibida']);
  assert.equal(r.resumen.kg_esperado, 19.24);
  assert.equal(r.resumen.kg_recibido, 19.24);
});

test('compararRecepcion: faltante, sobrante y otro peso con acción y motivo', () => {
  const r = compararRecepcion(
    [{ id: 1, codigo_barras: CAJA_A, peso_kg: 8.74 }, { id: 2, codigo_barras: CAJA_B, peso_kg: 10.5 }, { id: 3, codigo_barras: CAJA_C, peso_kg: 9.9 }],
    {
      cajas: [{ codigo: CAJA_A, kg_recibido: 8.1 }, { codigo: CAJA_C }, { codigo: CAJA_X, kg_etiqueta: 7.77 }],
      diferencias: [
        { tipo: 'peso_no_cuadra', codigo: CAJA_A, esperado: 8.74, recibido: 8.1, accion: 'avisar_planta', motivo: 'Pesa 640 g menos' },
        { tipo: 'caja_faltante', codigo: CAJA_B, accion: 'avisar_planta', motivo: 'No venía en el camión' },
        { tipo: 'caja_no_solicitada', codigo: CAJA_X, accion: 'devolver_mismo_transporte', motivo: 'No la pedimos' },
      ],
    });
  assert.equal(r.estado, 'recibida_con_diferencias');
  const por = Object.fromEntries(r.cajas.map(c => [c.codigo, c]));
  assert.equal(por[CAJA_A].resultado, 'otro_peso');
  assert.equal(por[CAJA_A].kg_recibido, 8.1);
  assert.equal(por[CAJA_A].motivo, 'Pesa 640 g menos');
  assert.equal(por[CAJA_B].resultado, 'faltante');
  assert.equal(por[CAJA_B].accion, 'avisar_planta');
  assert.equal(por[CAJA_C].resultado, 'recibida');
  assert.equal(por[CAJA_X].resultado, 'sobrante');
  assert.equal(por[CAJA_X].item_id, null);
  assert.equal(por[CAJA_X].accion, 'devolver_mismo_transporte');
  assert.deepEqual([r.resumen.cajas_recibidas, r.resumen.cajas_faltantes, r.resumen.cajas_sobrantes, r.resumen.cajas_otro_peso], [2, 1, 1, 1]);
});

test('compararRecepcion: dos cajas idénticas cuentan dos veces (una llegó, otra falta)', () => {
  const r = compararRecepcion(
    [{ id: 1, codigo_barras: CAJA_A, peso_kg: 8.74 }, { id: 2, codigo_barras: CAJA_A, peso_kg: 8.74 }],
    { cajas: [{ codigo: CAJA_A }], diferencias: [{ tipo: 'caja_faltante', codigo: CAJA_A, accion: 'avisar_planta', motivo: 'Llegó una sola' }] });
  assert.deepEqual(r.cajas.map(c => c.resultado), ['recibida', 'faltante']);
});

// ── MySQL real ──────────────────────────────────────────────────────────────────────────────
const HOST = process.env.TEST_MYSQL_HOST;
const opciones = { skip: !HOST && 'sin TEST_MYSQL_HOST: prueba de MySQL real omitida' };
if (HOST) {
  process.env.DB_HOST = HOST;
  process.env.DB_PORT = process.env.TEST_MYSQL_PORT || '3306';
  process.env.DB_USER = process.env.TEST_MYSQL_USER || 'hacienda_admin';
  process.env.DB_PASSWORD = process.env.TEST_MYSQL_PASSWORD || 'hacienda_pass';
  process.env.DB_NAME = process.env.TEST_MYSQL_DB || 'hacienda_tracking';
}

test('MySQL real: inventario 107 → orden → despacho → recepción firmada por caja', opciones, async (t) => {
  process.env.INTEGRACION_TIENDA_SECRETO = vectores.secreto;
  process.env.INTEGRACION_TIENDA_MODO = 'encendido';
  const express = require('express');
  const { pool, initDB } = require('../src/models/database');
  await initDB();

  const app = express();
  app.use('/api/integracion/tienda', require('../src/routes/integracion-tienda'));
  app.use(express.json());
  app.use('/api/traslados-tienda', require('../src/routes/traslados-tienda'));
  app.use('/api/ordenes-salida', require('../src/routes/ordenes-salida'));
  app.use('/api/inventario-planta', require('../src/routes/inventario-planta'));
  const srv = app.listen(0);
  t.after(async () => { srv.close(); await pool.end(); });
  const base = `http://127.0.0.1:${srv.address().port}`;

  const firmado = async (metodo, ruta, cuerpo = '') => {
    const fecha = String(Date.now());
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'X-Integracion-Clave': 'tienda-v1', 'X-Integracion-Fecha': fecha, 'Content-Type': 'application/json',
        'X-Integracion-Firma': firmar({ secreto: vectores.secreto, fecha, metodo, ruta, cuerpo }) },
      body: metodo === 'GET' ? undefined : cuerpo,
    });
    return { status: r.status, cabeceras: r.headers, json: await r.json() };
  };
  const json = async (metodo, ruta, cuerpo) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, json: await r.json() };
  };

  // Snapshot propio (el más reciente) con 3 cajas de INV GENERAL y 1 de maduración sin código.
  const huella = crypto.randomBytes(32).toString('hex');
  const [carga] = await pool.query("INSERT INTO inventario_planta_cargas (archivo, contenido_sha256) VALUES ('test-traslado.xlsx', ?)", [huella]);
  const ids = [];
  for (const [codigo, peso] of [[CAJA_A, 8.74], [CAJA_B, 10.5], [CAJA_C, 9.9]]) {
    const [l] = await pool.query(
      "INSERT INTO inventario_planta_lineas (carga_id, hoja, codigo_barras, codigo, descripcion, peso, lote, bms, trazabilidad) VALUES (?, 'general', ?, '26617', 'RIBEYE', ?, '0035', 11, 'sin_trazabilidad')",
      [carga.insertId, codigo, peso]);
    ids.push(l.insertId);
  }
  const [mad] = await pool.query("INSERT INTO inventario_planta_lineas (carga_id, hoja, codigo, peso) VALUES (?, 'maduracion', '26617', 5)", [carga.insertId]);

  // Validaciones de la solicitud.
  assert.equal((await json('POST', '/api/traslados-tienda', { linea_ids: ids })).status, 400); // falta quién pide
  assert.equal((await json('POST', '/api/traslados-tienda', { linea_ids: [mad.insertId], solicitante: 'Carolina' })).status, 400);

  const creada = await json('POST', '/api/traslados-tienda', { linea_ids: ids, solicitante: 'Carolina', notas: 'Para el fin de semana' });
  assert.equal(creada.status, 201, JSON.stringify(creada.json));
  assert.equal(creada.json.cajas, 3);
  // La misma caja no se pide dos veces mientras la orden esté viva.
  assert.equal((await json('POST', '/api/traslados-tienda', { linea_ids: [ids[0]], solicitante: 'Michelle' })).status, 409);

  const det = await json('GET', `/api/traslados-tienda/${creada.json.id}`);
  assert.equal(det.json.items.length, 3);
  assert.match(det.json.texto_planta, new RegExp(CAJA_B));
  assert.match(det.json.texto_planta, /Total: 3 caja\(s\) · 29\.14 kg/);

  // Despacho (el mismo endpoint de siempre). Antes de despachar la tienda no la ve.
  assert.equal((await json('POST', `/api/ordenes-salida/${creada.json.id}/despachar`)).status, 200);
  // El despacho se publica 5 s después de confirmado (asentamiento): se adelanta el reloj de la orden.
  await pool.query('UPDATE ordenes_salida SET despachada_en = NOW(3) - INTERVAL 10 SECOND WHERE id = ?', [creada.json.id]);
  let cursor = '';
  let despacho = null;
  for (let i = 0; i < 50 && !despacho; i++) {
    const r = await firmado('GET', `/api/integracion/tienda/despachos?limite=200${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(r.status, 200);
    despacho = r.json.despachos.find(d => d.numero === creada.json.numero) || null;
    if (!r.json.hay_mas) break;
    cursor = r.json.siguiente_cursor;
  }
  assert.ok(despacho, 'la orden despachada aparece en /despachos');
  assert.equal(despacho.prueba, false);
  assert.deepEqual(despacho.lineas.map(l => [l.codigo, l.formato, l.codigo_articulo, l.lote, l.bms]),
    [[CAJA_A, 'ciisa_caja', '26617', '0035', null], [CAJA_B, 'ciisa_caja', '26617', '0035', null], [CAJA_C, 'ciisa_caja', '26617', '0035', null]]);
  // El sufijo «11» de la caja NO es BMS (JC, 07-nov-2026): las 3 cajas no tienen animal → bms null.

  // Caso positivo: una caja ligada a un animal cuyo sacrificio tiene marmoleo medido → ese
  // marmoleo viaja como bms a /despachos (lib/bmsCaja.js, bmsVivo).
  const areteBms = `TR-BMS-${Date.now()}`;
  const [animalBms] = await pool.query("INSERT INTO animales (numero_trazabilidad, tipo, sexo, estado) VALUES (?, 'bovino', 'macho', 'sacrificado')", [areteBms]);
  await pool.query("INSERT INTO sacrificios (animal_id, fecha, marmoleo) VALUES (?, '2026-10-20 08:00:00', 7)", [animalBms.insertId]);
  const CAJA_D = '2661700650XXX061125003611';
  const [lBms] = await pool.query(
    "INSERT INTO inventario_planta_lineas (carga_id, hoja, codigo_barras, codigo, descripcion, peso, lote, bms, trazabilidad, arete, animal_id) VALUES (?, 'general', ?, '26617', 'RIBEYE', 6.5, '0036', 11, 'con_arete', ?, ?)",
    [carga.insertId, CAJA_D, areteBms.slice(0, 20), animalBms.insertId]);
  const conBms = await json('POST', '/api/traslados-tienda', { linea_ids: [lBms.insertId], solicitante: 'Carolina' });
  assert.equal(conBms.status, 201, JSON.stringify(conBms.json));
  assert.equal((await json('POST', `/api/ordenes-salida/${conBms.json.id}/despachar`)).status, 200);
  await pool.query('UPDATE ordenes_salida SET despachada_en = NOW(3) - INTERVAL 10 SECOND WHERE id = ?', [conBms.json.id]);
  let despachoBms = null;
  cursor = '';
  for (let i = 0; i < 50 && !despachoBms; i++) {
    const r = await firmado('GET', `/api/integracion/tienda/despachos?limite=200${cursor ? `&cursor=${cursor}` : ''}`);
    despachoBms = r.json.despachos.find(d => d.numero === conBms.json.numero) || null;
    if (!r.json.hay_mas) break;
    cursor = r.json.siguiente_cursor;
  }
  assert.ok(despachoBms, 'la orden con la caja ligada aparece en /despachos');
  assert.deepEqual(despachoBms.lineas.map(l => [l.codigo, l.bms]), [[CAJA_D, 7]]);
  await pool.query('DELETE FROM ordenes_salida WHERE id = ?', [conBms.json.id]);
  await pool.query('DELETE FROM inventario_planta_lineas WHERE id = ?', [lBms.insertId]);
  await pool.query('DELETE FROM animales WHERE id = ?', [animalBms.insertId]);

  // Recepción en la tienda: A con otro peso, B faltante, C bien, X sobrante devuelta.
  const recepcionId = `R${Date.now()}`;
  const sobre = {
    v: 1, clave: `traslado.recibido:${recepcionId}`, tipo: 'traslado.recibido', ocurrido_en: new Date().toISOString(),
    origen: { app: 'tienda', usuario: 'Carolina (administrador)', ip: null },
    datos: {
      numero_orden: creada.json.numero, recepcion_id: recepcionId, cerrada_en: new Date().toISOString(),
      cajas: [{ codigo: CAJA_A, copia: 1, kg_etiqueta: 8.74, kg_recibido: 8.1 }, { codigo: CAJA_C, copia: 1, kg_etiqueta: 9.9 }, { codigo: CAJA_X, copia: 1, kg_etiqueta: 7.77 }],
      diferencias: [
        { tipo: 'peso_no_cuadra', codigo: CAJA_A, esperado: 8.74, recibido: 8.1, accion: 'avisar_planta', motivo: 'Pesa menos que la etiqueta' },
        { tipo: 'caja_faltante', codigo: CAJA_B, accion: 'avisar_planta', motivo: 'No venía' },
        { tipo: 'caja_no_solicitada', codigo: CAJA_X, accion: 'devolver_mismo_transporte', motivo: 'No se pidió' },
      ],
    },
  };
  const cuerpo = JSON.stringify(sobre);
  const r1 = await firmado('POST', '/api/integracion/tienda/eventos', cuerpo);
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.aplicado, true);
  assert.equal(r1.json.recepcion.estado, 'recibida_con_diferencias');
  assert.deepEqual([r1.json.recepcion.cajas_recibidas, r1.json.recepcion.cajas_faltantes, r1.json.recepcion.cajas_sobrantes], [2, 1, 1]);

  const [[orden]] = await pool.query('SELECT recepcion_estado, recepcion_por FROM ordenes_salida WHERE id = ?', [creada.json.id]);
  assert.deepEqual([orden.recepcion_estado, orden.recepcion_por], ['recibida_con_diferencias', 'Carolina (administrador)']);
  const [porCaja] = await pool.query(
    'SELECT c.codigo, c.resultado, c.accion FROM recepciones_tienda_cajas c JOIN recepciones_tienda r ON r.id = c.recepcion_id WHERE r.evento_clave = ? ORDER BY c.id', [sobre.clave]);
  assert.deepEqual(porCaja.map(c => [c.codigo, c.resultado, c.accion]), [
    [CAJA_A, 'otro_peso', 'avisar_planta'], [CAJA_B, 'faltante', 'avisar_planta'], [CAJA_C, 'recibida', null], [CAJA_X, 'sobrante', 'devolver_mismo_transporte']]);

  // Reenvío idéntico: mismo resultado, sin escribir otra recepción.
  const r2 = await firmado('POST', '/api/integracion/tienda/eventos', cuerpo);
  assert.equal(r2.status, 200);
  assert.equal(r2.cabeceras.get('idempotency-replayed'), 'true');
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM recepciones_tienda WHERE evento_clave = ?', [sobre.clave]);
  assert.equal(n.n, 1);
  // Misma clave con otro contenido: 409.
  const otro = JSON.stringify({ ...sobre, datos: { ...sobre.datos, diferencias: [] } });
  assert.equal((await firmado('POST', '/api/integracion/tienda/eventos', otro)).status, 409);

  // Una segunda recepción (otra recepcion_id) de la misma orden: 409, no se aplica nada.
  const otraId = `R${Date.now()}c`;
  const repetida = { ...sobre, clave: `traslado.recibido:${otraId}`, datos: { ...sobre.datos, recepcion_id: otraId } };
  const rr = await firmado('POST', '/api/integracion/tienda/eventos', JSON.stringify(repetida));
  assert.equal(rr.status, 409);
  assert.equal(rr.json.error, 'orden_ya_recibida');
  const [[nr]] = await pool.query('SELECT COUNT(*) AS n FROM recepciones_tienda WHERE orden_id = ?', [creada.json.id]);
  assert.equal(nr.n, 1);
  // Una orden despachada (o con recepción) no se borra: se anula.
  assert.equal((await json('DELETE', `/api/ordenes-salida/${creada.json.id}`)).status, 409);

  // Orden sin despachar: la recepción no se aplica (409); anularla por PUT sí se puede.
  const [carga2] = await pool.query("INSERT INTO inventario_planta_cargas (archivo, contenido_sha256) VALUES ('test-traslado-2.xlsx', ?)", [crypto.randomBytes(32).toString('hex')]);
  const [l2] = await pool.query("INSERT INTO inventario_planta_lineas (carga_id, hoja, codigo_barras, codigo, peso) VALUES (?, 'general', ?, '26617', 7.77)", [carga2.insertId, CAJA_X]);
  const pendiente = await json('POST', '/api/traslados-tienda', { linea_ids: [l2.insertId], solicitante: 'Michelle' });
  assert.equal(pendiente.status, 201);
  const idP = `R${Date.now()}d`;
  const sobreNoDesp = { ...sobre, clave: `traslado.recibido:${idP}`, datos: { ...sobre.datos, numero_orden: pendiente.json.numero, recepcion_id: idP } };
  const rn = await firmado('POST', '/api/integracion/tienda/eventos', JSON.stringify(sobreNoDesp));
  assert.equal(rn.status, 409);
  assert.equal(rn.json.error, 'orden_no_despachada');
  assert.equal((await json('PUT', `/api/ordenes-salida/${pendiente.json.id}`, { estado: 'cancelada' })).status, 200);
  // …pero una orden genérica no puede armarse 107 → WC-01 cambiando bodegas por PUT.
  const [[b]] = await pool.query("SELECT (SELECT id FROM bodegas WHERE codigo = '107') AS b107, (SELECT id FROM bodegas WHERE codigo = 'BOD-DSP') AS dsp");
  const generica = await json('POST', '/api/ordenes-salida', { fecha: '2026-11-06', bodega_origen_id: b.dsp });
  assert.equal(generica.status, 201);
  assert.equal((await json('PUT', `/api/ordenes-salida/${generica.json.id}`, { bodega_origen_id: b.b107, bodega_destino_id: (await pool.query("SELECT id FROM bodegas WHERE codigo = 'WC-01'"))[0][0].id })).status, 400);
  await pool.query('DELETE FROM ordenes_salida WHERE id = ?', [generica.json.id]);

  // Una carga PRUEBA (seed) no se vuelve «el último snapshot» real ni entra en la comparación.
  const [carga3] = await pool.query("INSERT INTO inventario_planta_cargas (archivo, contenido_sha256, es_prueba) VALUES ('PRUEBA-test.xlsx', ?, 1)", [crypto.randomBytes(32).toString('hex')]);
  const [l3] = await pool.query("INSERT INTO inventario_planta_lineas (carga_id, hoja, codigo_barras, codigo, peso) VALUES (?, 'general', ?, '26617', 9.9)", [carga3.insertId, CAJA_C]);
  const vista = await json('GET', '/api/inventario-planta/lineas');
  assert.equal(vista.json.carga.id, carga2.insertId);
  assert.equal(vista.json.carga.es_ultima, true);
  const vistaP = await json('GET', `/api/inventario-planta/lineas?carga_id=${carga3.insertId}`);
  assert.deepEqual([vistaP.json.carga.es_prueba, vistaP.json.carga.es_ultima], [true, true]);
  const comp = await json('GET', '/api/inventario-planta/comparacion');
  assert.notEqual(comp.json.anterior && comp.json.anterior.id, carga3.insertId);
  // Desde la carga real se sigue pidiendo (es la última real) y desde la PRUEBA también.
  const [l2b] = await pool.query("INSERT INTO inventario_planta_lineas (carga_id, hoja, codigo_barras, codigo, peso) VALUES (?, 'general', ?, '26617', 5.5)", [carga2.insertId, CAJA_A]);
  const real2 = await json('POST', '/api/traslados-tienda', { linea_ids: [l2b.insertId], solicitante: 'JC' });
  assert.equal(real2.status, 201, JSON.stringify(real2.json));
  const prueba = await json('POST', '/api/traslados-tienda', { linea_ids: [l3.insertId], solicitante: 'Carolina', es_prueba: true });
  assert.equal(prueba.status, 201, JSON.stringify(prueba.json));

  // Cursor: OS-A real despachada a las 10:00, OS-B PRUEBA a las 11:00. En modo pruebas la tienda
  // ve solo OS-B; si siguiera con ESE cursor al encender, perdería OS-A. Con el cursor real
  // intacto (sincronizar.ts guarda uno aparte por modo) OS-A llega al encender.
  assert.equal((await json('POST', `/api/ordenes-salida/${real2.json.id}/despachar`)).status, 200);
  assert.equal((await json('POST', `/api/ordenes-salida/${prueba.json.id}/despachar`)).status, 200);
  await pool.query('UPDATE ordenes_salida SET despachada_en = NOW(3) - INTERVAL 2 HOUR WHERE id = ?', [real2.json.id]);
  await pool.query('UPDATE ordenes_salida SET despachada_en = NOW(3) - INTERVAL 1 HOUR WHERE id = ?', [prueba.json.id]);
  const todos = async (cursorIni) => {
    let c = cursorIni;
    const vistos = [];
    for (let i = 0; i < 50; i++) {
      const r = await firmado('GET', `/api/integracion/tienda/despachos?limite=200${c ? `&cursor=${c}` : ''}`);
      assert.equal(r.status, 200);
      vistos.push(...r.json.despachos.map(d => d.numero));
      c = r.json.siguiente_cursor;
      if (!r.json.hay_mas) break;
    }
    return { vistos, cursor: c };
  };
  process.env.INTEGRACION_TIENDA_MODO = 'pruebas';
  const enPruebas = await todos('');
  assert.ok(enPruebas.vistos.includes(prueba.json.numero));
  assert.ok(!enPruebas.vistos.includes(real2.json.numero));
  process.env.INTEGRACION_TIENDA_MODO = 'encendido';
  assert.ok(!(await todos(enPruebas.cursor)).vistos.includes(real2.json.numero), 'con el cursor de pruebas, OS-A se perdería');
  assert.ok((await todos('')).vistos.includes(real2.json.numero), 'con el cursor real intacto, OS-A llega al encender');

  // Modo pruebas: una orden real (no PRUEBA) no se aplica.
  process.env.INTEGRACION_TIENDA_MODO = 'pruebas';
  const otraRecepcion = `R${Date.now()}b`;
  const sobreP = { ...sobre, clave: `traslado.recibido:${otraRecepcion}`, datos: { ...sobre.datos, recepcion_id: otraRecepcion } };
  const rp = await firmado('POST', '/api/integracion/tienda/eventos', JSON.stringify(sobreP));
  assert.equal(rp.status, 422);
  assert.equal(rp.json.error, 'solo_pruebas');
  // …y en pruebas /despachos no muestra órdenes reales.
  const rd = await firmado('GET', '/api/integracion/tienda/despachos?limite=200');
  assert.ok(rd.json.despachos.every(d => d.prueba === true));

  // Detalle del traslado con la recepción por caja.
  const det2 = await json('GET', `/api/traslados-tienda/${creada.json.id}`);
  assert.equal(det2.json.recepciones.length, 1);
  assert.equal(det2.json.recepciones[0].cajas.length, 4);

  // Limpieza: la orden (cascada a ítems y recepción) y el snapshot de la prueba.
  await pool.query('DELETE FROM integracion_eventos WHERE clave = ?', [sobre.clave]);
  await pool.query('DELETE FROM ordenes_salida WHERE id IN (?)', [[creada.json.id, pendiente.json.id, real2.json.id, prueba.json.id]]);
  await pool.query('DELETE FROM inventario_planta_cargas WHERE id IN (?)', [[carga.insertId, carga2.insertId, carga3.insertId]]);
});
