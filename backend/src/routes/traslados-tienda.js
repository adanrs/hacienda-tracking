// /api/traslados-tienda — traslados de la planta (bodega 107) a la tienda (WC-01).
//
// Reemplaza el Excel de ida y vuelta que describió Juan Carlos (05-nov-2026): la planta manda el
// inventario semanal (se carga en «Inventario de la planta»), quien pide (Carolina, Michelle o JC)
// marca las cajas que quiere y la app genera la orden de salida 107 → WC-01 con la lista para la
// planta (imprimir o compartir por WhatsApp). La planta pistolea la caja completa sin abrirla, así
// que la orden es POR CAJA.
//
// Al despacharse (POST /api/ordenes-salida/:id/despachar, el mismo de siempre) la orden aparece en
// GET /api/integracion/tienda/despachos: así se «publica» a la tienda. La integración tiene un solo
// cliente (la tienda consulta y empuja eventos; ganadería nunca la llama), por eso no hay cola de
// salida de este lado. La recepción vuelve como evento traslado.recibido
// (lib/integracion/procesadorTraslado.js) y se ve en el detalle de la orden.
//
//   GET  /                → órdenes hacia WC-01 con su resumen (cajas, kg, recepción)
//   GET  /:id             → detalle: líneas, recepción por caja y el texto para la planta
//   POST /                → crea la orden desde líneas del inventario de la planta
//
// Todo valor del request va por `?`.

const router = require('express').Router();
const { idsNumericos } = require('../lib/params');
const { pool } = require('../models/database');
const { numeroDiario } = require('../lib/consecutivos');
const { decodificar, normalizar } = require('../lib/etiquetas');
const { bmsVivo } = require('../lib/bmsCaja');
const { WC01, B107 } = require('../lib/bodegasV10');

idsNumericos(router);

const MAX_CAJAS = 300;

const envolver = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[traslados-tienda]', err);
  res.status(500).json({ error: 'Error interno en los traslados a la tienda' });
});

const num = (v) => (v === null || v === undefined ? null : Number(v));
const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Ids de las bodegas 107 y WC-01 (sembradas por la migración v10). */
async function bodegasTraslado(conn) {
  const [r] = await conn.query('SELECT id, codigo FROM bodegas WHERE codigo IN (?, ?)', [B107, WC01]);
  const m = new Map(r.map(b => [b.codigo, b.id]));
  return { b107: m.get(B107) || null, wc01: m.get(WC01) || null };
}

/**
 * Texto de la orden para la planta (imprimir o pegar en WhatsApp). La planta busca cada caja por su
 * código de barras, así que va completo, agrupado por producto con subtotales.
 */
function textoParaPlanta(orden, items) {
  const porCodigo = new Map();
  for (const it of items) {
    const k = `${it.codigo_articulo || '—'} ${it.descripcion || ''}`.trim();
    if (!porCodigo.has(k)) porCodigo.set(k, []);
    porCodigo.get(k).push(it);
  }
  const kg = (x) => Number(x || 0).toFixed(2);
  const lineas = [
    `Orden de traslado ${orden.numero}${orden.es_prueba ? ' (PRUEBA)' : ''}`,
    'De: bodega 107 (EQTB Tempisque, CIISA) · A: tienda Wagyu Cross (WC-01)',
    `Fecha: ${String(orden.fecha_txt || '').trim()}${orden.solicitante ? ` · Pide: ${orden.solicitante}` : ''}`,
    '',
  ];
  for (const [producto, cajas] of porCodigo) {
    lineas.push(`${producto} · ${cajas.length} caja(s) · ${kg(cajas.reduce((s, c) => s + Number(c.peso_kg || 0), 0))} kg`);
    for (const c of cajas) lineas.push(`  ${c.codigo_barras}  ${kg(c.peso_kg)} kg${c.lote ? `  lote ${c.lote}` : ''}`);
  }
  lineas.push('', `Total: ${items.length} caja(s) · ${kg(items.reduce((s, c) => s + Number(c.peso_kg || 0), 0))} kg`);
  if (orden.notas) lineas.push(`Notas: ${orden.notas}`);
  return lineas.join('\n');
}

router.get('/', envolver(async (req, res) => {
  const { wc01 } = await bodegasTraslado(pool);
  if (!wc01) return res.json([]);
  const [rows] = await pool.query(`
    SELECT o.id, o.numero, DATE_FORMAT(o.fecha, '%Y-%m-%d') AS fecha, o.solicitante, o.estado, o.notas, o.es_prueba,
           DATE_FORMAT(o.despachada_en, '%Y-%m-%d %H:%i') AS despachada_en,
           o.recepcion_estado, DATE_FORMAT(o.recepcion_en, '%Y-%m-%d %H:%i') AS recepcion_en, o.recepcion_por,
           bo.codigo AS origen_codigo,
           (SELECT COUNT(*) FROM ordenes_salida_items i WHERE i.orden_id = o.id) AS cajas,
           (SELECT COALESCE(SUM(i.peso_kg), 0) FROM ordenes_salida_items i WHERE i.orden_id = o.id) AS kg
    FROM ordenes_salida o
    LEFT JOIN bodegas bo ON bo.id = o.bodega_origen_id
    WHERE o.bodega_destino_id = ?
    ORDER BY o.id DESC
    LIMIT 200`, [wc01]);
  res.json(rows.map(r => ({ ...r, es_prueba: Boolean(r.es_prueba), kg: Number(r.kg) })));
}));

router.get('/:id', envolver(async (req, res) => {
  const [[orden]] = await pool.query(`
    SELECT o.id, o.numero, DATE_FORMAT(o.fecha, '%Y-%m-%d') AS fecha, DATE_FORMAT(o.fecha, '%d/%m/%Y') AS fecha_txt,
           o.solicitante, o.destino, o.estado, o.notas, o.es_prueba,
           DATE_FORMAT(o.despachada_en, '%Y-%m-%d %H:%i') AS despachada_en,
           o.recepcion_estado, DATE_FORMAT(o.recepcion_en, '%Y-%m-%d %H:%i') AS recepcion_en, o.recepcion_por,
           bo.codigo AS origen_codigo, bd.codigo AS destino_codigo
    FROM ordenes_salida o
    LEFT JOIN bodegas bo ON bo.id = o.bodega_origen_id
    LEFT JOIN bodegas bd ON bd.id = o.bodega_destino_id
    WHERE o.id = ?`, [req.params.id]);
  if (!orden || orden.destino_codigo !== WC01) return res.status(404).json({ error: 'Traslado no encontrado' });
  const [items] = await pool.query(`
    SELECT i.id, i.codigo_barras, i.codigo_articulo, i.descripcion, i.peso_kg, i.lote, i.arete, i.inventario_linea_id,
           i.caja_id, c.codigo AS caja_codigo, il.animal_id
    FROM ordenes_salida_items i LEFT JOIN cajas c ON c.id = i.caja_id
    LEFT JOIN inventario_planta_lineas il ON il.id = i.inventario_linea_id
    WHERE i.orden_id = ? ORDER BY i.codigo_articulo, i.id`, [orden.id]);
  // BMS vivo (lib/bmsCaja.js): marmoleo medido del animal de la caja, o null. No se usa `i.bms`:
  // las órdenes armadas antes del 07-nov-2026 guardaron ahí el sufijo de la caja, que no es el BMS.
  const bmsItems = await bmsVivo(pool, items);
  const [recepciones] = await pool.query(`
    SELECT id, evento_clave, recepcion_tienda, estado, recibida_por,
           DATE_FORMAT(cerrada_en, '%Y-%m-%d %H:%i') AS cerrada_en, DATE_FORMAT(registrada_en, '%Y-%m-%d %H:%i') AS registrada_en,
           cajas_recibidas, cajas_faltantes, cajas_sobrantes, cajas_otro_peso, kg_esperado, kg_recibido
    FROM recepciones_tienda WHERE orden_id = ? ORDER BY id`, [orden.id]);
  let cajas = [];
  if (recepciones.length) {
    [cajas] = await pool.query(`
      SELECT recepcion_id, item_id, codigo, resultado, kg_esperado, kg_recibido, accion, motivo
      FROM recepciones_tienda_cajas WHERE recepcion_id IN (?) ORDER BY id`, [recepciones.map(r => r.id)]);
  }
  const salida = { ...orden, es_prueba: Boolean(orden.es_prueba) };
  const itemsSalida = items.map(({ animal_id: _a, ...i }, k) => ({ ...i, peso_kg: num(i.peso_kg), bms: bmsItems[k].bms }));
  res.json({
    ...salida,
    items: itemsSalida,
    recepciones: recepciones.map(r => ({
      ...r, kg_esperado: num(r.kg_esperado), kg_recibido: num(r.kg_recibido),
      cajas: cajas.filter(c => c.recepcion_id === r.id).map(c => ({ ...c, kg_esperado: num(c.kg_esperado), kg_recibido: num(c.kg_recibido) })),
    })),
    texto_planta: textoParaPlanta(salida, itemsSalida),
  });
}));

router.post('/', envolver(async (req, res) => {
  const b = req.body || {};
  const ids = Array.isArray(b.linea_ids) ? [...new Set(b.linea_ids.map(Number))] : [];
  if (!ids.length || ids.some(x => !Number.isInteger(x) || x <= 0)) return res.status(400).json({ error: 'Marque al menos una caja (linea_ids)' });
  if (ids.length > MAX_CAJAS) return res.status(400).json({ error: `Máximo ${MAX_CAJAS} cajas por traslado` });
  const solicitante = texto(b.solicitante, 80);
  if (!solicitante) return res.status(400).json({ error: 'Indique quién pide el traslado' });
  const fecha = b.fecha === undefined || b.fecha === '' ? null : String(b.fecha);
  if (fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha debe ser AAAA-MM-DD' });
  const notas = texto(b.notas, 500);
  const esPrueba = b.es_prueba === true ? 1 : 0;

  const conn = await pool.getConnection();
  try {
    const { b107, wc01 } = await bodegasTraslado(conn);
    if (!b107 || !wc01) return res.status(503).json({ error: 'Faltan las bodegas 107 o WC-01 (migración v10)' });
    await conn.beginTransaction();
    const [lineas] = await conn.query(`
      SELECT l.id, l.carga_id, l.hoja, l.codigo_barras, l.codigo, l.descripcion, l.peso, l.lote, l.arete, l.animal_id, l.medida
      FROM inventario_planta_lineas l WHERE l.id IN (?) FOR UPDATE`, [ids]);
    if (lineas.length !== ids.length) { await conn.rollback(); return res.status(404).json({ error: 'Alguna caja ya no está en el inventario cargado' }); }
    const cargas = new Set(lineas.map(l => l.carga_id));
    if (cargas.size !== 1) { await conn.rollback(); return res.status(400).json({ error: 'Las cajas tienen que ser del mismo inventario (snapshot)' }); }
    // El último snapshot de su clase: las cajas PRUEBA se piden del último de PRUEBA y las reales
    // del último real (la carga del seed no tapa el inventario real).
    const [[ultima]] = await conn.query(
      'SELECT MAX(id) AS id FROM inventario_planta_cargas WHERE es_prueba = (SELECT es_prueba FROM inventario_planta_cargas WHERE id = ?)', [lineas[0].carga_id]);
    if (Number(ultima.id) !== Number(lineas[0].carga_id)) {
      await conn.rollback();
      return res.status(409).json({ error: 'Hay un inventario de la planta más reciente: marque las cajas en el último snapshot' });
    }
    const sinCodigo = lineas.filter(l => l.hoja !== 'general' || !l.codigo_barras);
    if (sinCodigo.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'Solo se piden cajas de «INV GENERAL» con código de barras (la planta las busca por el código)' });
    }
    // Una línea solo puede estar en una orden viva: pedirla dos veces haría que la planta busque una
    // caja que ya salió. Las órdenes anuladas no cuentan.
    const [enOrden] = await conn.query(`
      SELECT i.inventario_linea_id, o.numero FROM ordenes_salida_items i JOIN ordenes_salida o ON o.id = i.orden_id
      WHERE i.inventario_linea_id IN (?) AND o.estado <> 'cancelada'`, [ids]);
    if (enOrden.length) {
      await conn.rollback();
      return res.status(409).json({ error: `Hay cajas que ya están en otro traslado (${[...new Set(enOrden.map(x => x.numero))].join(', ')})`, lineas: enOrden.map(x => x.inventario_linea_id) });
    }
    // El mismo código en una orden viva de otra semana: casi seguro es la misma caja que la planta
    // todavía reporta (su inventario va con atraso). Es aviso, no bloqueo: dos cajas idénticas
    // (mismo producto, peso, fecha, lote y sufijo) son raras pero posibles.
    const codigos = lineas.map(l => normalizar(l.codigo_barras));
    const [repetidos] = await conn.query(`
      SELECT i.codigo_barras, o.numero FROM ordenes_salida_items i JOIN ordenes_salida o ON o.id = i.orden_id
      WHERE i.codigo_barras IN (?) AND o.estado <> 'cancelada'`, [codigos]);
    const avisos = repetidos.map(r => ({ tipo: 'codigo_en_otro_traslado', codigo: r.codigo_barras, numero: r.numero }));

    const numero = await numeroDiario(conn, { prefijo: 'OS', tabla: 'ordenes_salida' });
    const [ins] = await conn.query(`
      INSERT INTO ordenes_salida (numero, fecha, solicitante, destino, bodega_origen_id, bodega_destino_id, estado, notas, es_prueba)
      VALUES (?, COALESCE(?, CURDATE()), ?, 'Tienda Wagyu Cross (WC-01)', ?, ?, 'pendiente', ?, ?)`,
    [numero, fecha, solicitante, b107, wc01, notas, esPrueba]);
    const ordenId = ins.insertId;
    // BMS de cada caja = marmoleo medido de su animal al armar la orden (el sufijo de la caja NO es
    // el BMS, JC 07-nov-2026). La integración con la tienda lo vuelve a calcular al despachar.
    const bmsLineas = await bmsVivo(conn, lineas);
    for (const [k, l] of lineas.entries()) {
      const codigo = normalizar(l.codigo_barras);
      const dec = decodificar(codigo);
      const articulo = l.codigo || (dec.campos && dec.campos.codigoProducto) || null;
      await conn.query(`
        INSERT INTO ordenes_salida_items (orden_id, cantidad, peso_kg, inventario_linea_id, codigo_barras, codigo_articulo, descripcion, lote, bms, arete)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ordenId, l.peso, l.id, codigo, articulo, l.descripcion, l.lote, bmsLineas[k].bms, l.arete]);
    }
    await conn.commit();
    res.status(201).json({ id: ordenId, numero, cajas: lineas.length, kg: lineas.reduce((s, l) => s + Number(l.peso || 0), 0), avisos });
  } catch (err) {
    try { await conn.rollback(); } catch { /* sin transacción abierta */ }
    throw err;
  } finally { conn.release(); }
}));

module.exports = router;
module.exports.textoParaPlanta = textoParaPlanta;
