// /api/integracion/tienda/* — API servicio a servicio para la tienda (wagyu-demo).
// Contrato: docs/integracion-tienda/README.md. Diseño: integracion-tienda-ganaderia.md (05-nov).
//
// La tienda es el único cliente: empuja eventos (POST /eventos) y consulta lo que ganadería
// despachó hacia WC-01 (GET /despachos). Todo pasa por firmaServicio (HMAC, sin JWT).
//
// Fase 1 (este archivo): ningún endpoint mueve inventario. POST /eventos en modo «sombra» valida,
// revisa las etiquetas contra lo que ganadería conoce (solo lectura), registra el evento en
// integracion_eventos y responde. En modo «encendido» responde 503 hasta que existan los
// procesadores (fases 2-3): así ningún evento queda «registrado» como si se hubiera aplicado.

const express = require('express');
const { pool } = require('../models/database');
const { USUARIO_SERVICIO_TIENDA } = require('../models/nucleoV10');
const { crearFirmaServicio } = require('../middleware/firmaServicio');
const { sha256hex } = require('../lib/integracion/firma');
const { validarSobre } = require('../lib/integracion/eventos');
const { decodificar, normalizar } = require('../lib/etiquetas');

const VERSION_CONTRATO = '1';
const LIMITE_POR_OMISION = 50;
const LIMITE_MAXIMO = 200;
// Un despacho recién confirmado podría tener un despachada_en anterior al de otro que ya se
// devolvió (transacciones que terminan en otro orden). Esperar unos segundos antes de exponerlo
// evita que la tienda avance el cursor por encima de él y lo pierda.
const ASENTAMIENTO_SEGUNDOS = 5;
// Cuando la tienda ya está al día (el cursor que trae se emitió con hay_mas = false), la próxima
// consulta relee los últimos 60 s antes del cursor: cubre un despacho cuya transacción confirmó
// tarde con un despachada_en anterior. Por eso la tienda DEBE deduplicar por `numero` (upsert).
// Solo se relee al empezar una consulta nueva, nunca entre páginas, así que no hay bucles.
const SOLAPAMIENTO_SEGUNDOS = 60;
const CURSOR_INICIAL = { t: '1000-01-01 00:00:00.000000', id: 0, fin: false };
const RE_CURSOR_T = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3,6}$/;

const router = express.Router();

// Cuerpo crudo (Buffer) para cualquier content-type: la firma se calcula sobre los bytes exactos
// y el JSON se parsea recién después de verificarla. Por eso este router se monta en index.js
// ANTES del express.json() global (si no, el stream ya llegaría consumido).
router.use(express.raw({ type: () => true, limit: '1mb' }));

router.use(crearFirmaServicio({
  buscarUsuarioServicio: async () => {
    const [r] = await pool.query(
      "SELECT id FROM usuarios WHERE username = ? AND rol = 'servicio' AND activo = 1 LIMIT 1", [USUARIO_SERVICIO_TIENDA]);
    return r.length ? r[0].id : null;
  },
}));

// ── Salud firmada ────────────────────────────────────────────────────────────────────────────
router.get('/salud', (req, res) => {
  res.json({ contrato: VERSION_CONTRATO, ahora: new Date().toISOString(), modo: req.integracion.modo });
});

// ── Despachos hacia WC-01 (paginado por cursor) ──────────────────────────────────────────────
function codificarCursor(c) { return Buffer.from(JSON.stringify(c)).toString('base64url'); }
function decodificarCursor(texto) {
  try {
    const c = JSON.parse(Buffer.from(String(texto), 'base64url').toString('utf8'));
    if (c && RE_CURSOR_T.test(c.t) && Number.isInteger(c.id) && c.id >= 0) return { t: c.t, id: c.id, fin: c.fin === true };
  } catch { /* cae al null */ }
  return null;
}

/** Etiqueta de un sticker tal como la ve la tienda: código normalizado + copia (+ lectura CIISA si la hay). */
function etiquetaDeSticker(s) {
  const codigo = normalizar(s.codigo_barras);
  const dec = codigo ? decodificar(codigo) : null;
  const esCiisa = dec && dec.tipo === 'paquete' && dec.errores.length === 0;
  return {
    codigo,
    copia: 1, // stickers.codigo_barras es UNIQUE: nunca hay dos con el mismo código
    kg: s.peso_kg === null ? null : Number(s.peso_kg),
    formato: esCiisa ? 'ciisa_paquete' : 'interno',
    ...(esCiisa ? {
      codigo_articulo: dec.campos.codigoProducto,
      // null cuando la planta puso «xxx»/«000000» (sin trazabilidad); ver docs/integracion-tienda.
      arete: dec.campos.arete,
      trazabilidad: dec.campos.trazabilidad || null,
      kg_etiqueta: dec.campos.pesoKg,
      cruce: dec.campos.genetica || null,
      bms: dec.campos.marmoleo ?? null,
    } : {}),
  };
}

router.get('/despachos', async (req, res) => {
  let limite = LIMITE_POR_OMISION;
  if (req.query.limite !== undefined) {
    limite = Number(req.query.limite);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      return res.status(400).json({ error: `limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}` });
    }
  }
  let cursor = CURSOR_INICIAL;
  if (req.query.cursor !== undefined && req.query.cursor !== '') {
    cursor = decodificarCursor(req.query.cursor);
    if (!cursor) return res.status(400).json({ error: 'cursor inválido' });
  }
  const solape = cursor.fin ? SOLAPAMIENTO_SEGUNDOS : 0;
  try {
    const [wc] = await pool.query("SELECT id FROM bodegas WHERE codigo = 'WC-01' LIMIT 1");
    if (!wc.length) return res.status(503).json({ error: 'No existe la bodega WC-01' });

    const [ordenes] = await pool.query(`
      SELECT o.id, o.numero, o.fecha, o.destino, o.notas, o.despachada_en,
             DATE_FORMAT(o.despachada_en, '%Y-%m-%d %H:%i:%s.%f') AS despachada_txt,
             bo.codigo AS origen_codigo, bo.nombre AS origen_nombre, bo.codigo_ciisa AS origen_codigo_ciisa
      FROM ordenes_salida o
      LEFT JOIN bodegas bo ON bo.id = o.bodega_origen_id
      WHERE o.estado = 'despachada'
        AND o.bodega_destino_id = ?
        AND o.despachada_en IS NOT NULL
        AND o.despachada_en <= NOW(3) - INTERVAL ${ASENTAMIENTO_SEGUNDOS} SECOND
        AND (o.despachada_en > (CAST(? AS DATETIME(6)) - INTERVAL ? SECOND)
             OR (o.despachada_en = (CAST(? AS DATETIME(6)) - INTERVAL ? SECOND) AND o.id > ?))
      ORDER BY o.despachada_en, o.id
      LIMIT ?
    `, [wc[0].id, cursor.t, solape, cursor.t, solape, cursor.fin ? 0 : cursor.id, limite + 1]);

    const hayMas = ordenes.length > limite;
    const pagina = hayMas ? ordenes.slice(0, limite) : ordenes;
    const ids = pagina.map(o => o.id);

    let items = [];
    let stickers = [];
    if (ids.length) {
      [items] = await pool.query(`
        SELECT i.id, i.orden_id, i.caja_id, i.primal_id, i.cantidad, i.peso_kg,
               c.codigo AS caja_codigo, c.tipo_corte AS caja_tipo_corte, c.peso_total_kg AS caja_peso_kg,
               pr.codigo AS primal_codigo, pr.tipo_primal, pr.peso_kg AS primal_peso_kg
        FROM ordenes_salida_items i
        LEFT JOIN cajas c ON c.id = i.caja_id
        LEFT JOIN primales pr ON pr.id = i.primal_id
        WHERE i.orden_id IN (?)
        ORDER BY i.orden_id, i.id
      `, [ids]);
      const cajasIds = [...new Set(items.map(i => i.caja_id).filter(Boolean))];
      if (cajasIds.length) {
        [stickers] = await pool.query(`
          SELECT s.caja_id, s.codigo_barras, s.peso_kg
          FROM stickers s
          WHERE s.caja_id IN (?)
          ORDER BY s.caja_id, s.id
        `, [cajasIds]);
      }
    }

    const stickersPorCaja = new Map();
    for (const s of stickers) {
      if (!stickersPorCaja.has(s.caja_id)) stickersPorCaja.set(s.caja_id, []);
      stickersPorCaja.get(s.caja_id).push(etiquetaDeSticker(s));
    }
    const itemsPorOrden = new Map();
    for (const it of items) {
      if (!itemsPorOrden.has(it.orden_id)) itemsPorOrden.set(it.orden_id, []);
      const esCaja = Boolean(it.caja_id);
      itemsPorOrden.get(it.orden_id).push({
        tipo: esCaja ? 'caja' : 'primal',
        codigo: esCaja ? it.caja_codigo : it.primal_codigo,
        descripcion: esCaja ? it.caja_tipo_corte : it.tipo_primal,
        cantidad: it.cantidad,
        kg: it.peso_kg !== null ? Number(it.peso_kg)
          : (esCaja ? (it.caja_peso_kg !== null ? Number(it.caja_peso_kg) : null) : (it.primal_peso_kg !== null ? Number(it.primal_peso_kg) : null)),
        etiquetas: esCaja ? (stickersPorCaja.get(it.caja_id) || []) : [],
      });
    }

    const despachos = pagina.map(o => ({
      numero: o.numero,
      estado: 'en_transito',
      origen: { codigo: o.origen_codigo, nombre: o.origen_nombre, codigo_ciisa: o.origen_codigo_ciisa },
      destino: { codigo: 'WC-01', texto: o.destino },
      fecha: o.fecha,
      despachado_en: o.despachada_en,
      notas: o.notas,
      lineas: itemsPorOrden.get(o.id) || [],
    }));
    const ultimo = pagina[pagina.length - 1];
    // Sin filas nuevas el cursor no avanza (y queda marcado como «al día» para el solapamiento).
    const siguiente = ultimo ? { t: ultimo.despachada_txt, id: ultimo.id } : { t: cursor.t, id: cursor.id };
    res.json({
      despachos,
      siguiente_cursor: codificarCursor({ ...siguiente, fin: !hayMas }),
      hay_mas: hayMas,
    });
  } catch (err) {
    console.error(`[integracion-tienda] despachos: ${err.message}`);
    res.status(500).json({ error: 'Error al consultar los despachos' });
  }
});

// ── Eventos de la tienda ─────────────────────────────────────────────────────────────────────

/**
 * Revisión de solo lectura para el modo sombra: formato de cada etiqueta y si ganadería la
 * conoce en el estado que el evento supone. Nunca falla el evento: la venta o la baja ya ocurrió
 * físicamente; las diferencias se devuelven como avisos y salen en la conciliación.
 */
async function revisarPiezas(tipo, info) {
  const avisos = [];
  const piezas = info.piezas || [];
  for (const p of piezas) {
    const dec = decodificar(p.codigo);
    if (dec.tipo !== 'paquete' || dec.errores.length) {
      avisos.push({ tipo: 'formato_invalido', codigo: p.codigo, copia: p.copia,
        detalle: dec.errores.length ? dec.errores[0].mensaje : `Se esperaba un paquete de 28 (llegó ${dec.tipo})` });
    } else if (p.kg !== null && dec.campos.pesoKg !== null && Math.abs(dec.campos.pesoKg - p.kg) > 0.0005) {
      // Pista de que los dos decodificadores (ganadería y tienda) se desincronizaron (riesgo §4.4).
      avisos.push({ tipo: 'peso_distinto_etiqueta', codigo: p.codigo, copia: p.copia, detalle: `La etiqueta dice ${dec.campos.pesoKg} kg y el evento ${p.kg} kg` });
    }
  }
  if (!piezas.length) return avisos;

  const [conocidas] = await pool.query(`
    SELECT e.codigo_crudo, e.copia, e.estado, b.codigo AS bodega
    FROM etiquetas e
    LEFT JOIN bodegas b ON b.id = e.bodega_actual_id
    WHERE (e.codigo_crudo, e.copia) IN (?)
  `, [piezas.map(p => [p.codigo, p.copia])]);
  const porLlave = new Map(conocidas.map(e => [`${e.codigo_crudo}#${e.copia}`, e]));

  for (const p of piezas) {
    const e = porLlave.get(`${p.codigo}#${p.copia}`);
    if (tipo === 'traslado.recibido') {
      if (e) avisos.push({ tipo: 'etiqueta_ya_existe', codigo: p.codigo, copia: p.copia, estado_actual: e.estado, bodega_actual: e.bodega });
      continue;
    }
    if (!e) {
      avisos.push({ tipo: 'etiqueta_desconocida', codigo: p.codigo, copia: p.copia });
    } else if (e.bodega !== 'WC-01' || (info.estadoEsperado && !info.estadoEsperado.includes(e.estado))) {
      avisos.push({ tipo: 'estado_no_cuadra', codigo: p.codigo, copia: p.copia, estado_actual: e.estado, bodega_actual: e.bodega });
    }
  }
  return avisos;
}

async function eventoGuardado(clave) {
  const [r] = await pool.query('SELECT hash_cuerpo, resultado FROM integracion_eventos WHERE clave = ? LIMIT 1', [clave]);
  if (!r.length) return null;
  const resultado = typeof r[0].resultado === 'string' ? JSON.parse(r[0].resultado) : r[0].resultado;
  return { hash: r[0].hash_cuerpo, resultado };
}

function responderGuardado(res, guardado, hash, clave) {
  if (guardado.hash !== hash) {
    return res.status(409).json({ error: 'clave_con_otro_contenido', clave,
      detalle: 'Ya se recibió un evento con esta clave y otro contenido: no se reintenta' });
  }
  res.set('Idempotency-Replayed', 'true');
  return res.status(200).json(guardado.resultado);
}

router.post('/eventos', async (req, res) => {
  const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  let sobre;
  try { sobre = JSON.parse(cuerpo.toString('utf8')); } catch {
    return res.status(422).json({ error: 'json_invalido' });
  }
  const v = validarSobre(sobre);
  if (!v.ok) return res.status(422).json({ error: 'evento_invalido', errores: v.errores });

  const idem = req.get('idempotency-key');
  if (idem !== undefined && idem !== sobre.clave) {
    return res.status(422).json({ error: 'evento_invalido', errores: ['Idempotency-Key debe ser igual a clave'] });
  }

  const { modo } = req.integracion;
  if (modo !== 'sombra') {
    // encendido sin procesadores: 503 (también para claves ya vistas en sombra) para que la
    // tienda reintente cuando existan, en vez de dar por aplicado algo que solo se validó.
    return res.status(503).json({ error: 'procesadores_no_disponibles', modo,
      detalle: 'Esta versión solo admite el modo sombra para eventos' });
  }

  const hash = sha256hex(cuerpo);
  const conn = await pool.getConnection();
  try {
    // Reenvío del mismo evento (lo normal tras un timeout de la tienda): resultado guardado, sin
    // volver a revisar ni a escribir nada.
    const previo = await eventoGuardado(sobre.clave);
    if (previo) return responderGuardado(res, previo, hash, sobre.clave);

    const avisos = [...v.avisos, ...await revisarPiezas(v.tipo, v.info)];
    const resultado = { clave: sobre.clave, resultado: 'registrado', modo, aplicado: false, avisos };

    await conn.beginTransaction();
    try {
      await conn.query(`
        INSERT INTO integracion_eventos
          (clave, tipo, origen_app, version_contrato, hash_cuerpo, modo, estado, avisos, payload, resultado, ocurrido_en)
        VALUES (?, ?, 'tienda', ?, ?, ?, 'registrado', ?, ?, ?, ?)
      `, [sobre.clave, sobre.tipo, sobre.v, hash, modo, Math.min(avisos.length, 65535),
        cuerpo.toString('utf8'), JSON.stringify(resultado), new Date(sobre.ocurrido_en)]);
      // Aquí irán, en la MISMA transacción, los movimientos de las fases 2-3 (diseño §3.4).
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      if (e.code === 'ER_DUP_ENTRY') {
        // Dos envíos simultáneos con la misma clave: el segundo espera al primero y llega aquí.
        const guardado = await eventoGuardado(sobre.clave);
        if (guardado) return responderGuardado(res, guardado, hash, sobre.clave);
      }
      throw e;
    }
    return res.status(200).json(resultado);
  } catch (err) {
    console.error(`[integracion-tienda] eventos ${sobre.clave}: ${err.code || ''} ${err.message}`);
    return res.status(500).json({ error: 'Error al registrar el evento' });
  } finally {
    conn.release();
  }
});

// Errores del body-parser (cuerpo > 1 MB, etc.) con el mismo formato JSON del resto.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'cuerpo_demasiado_grande' });
  console.error(`[integracion-tienda] ${err.message}`);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'Error en la integración' });
});

module.exports = router;
module.exports.decodificarCursor = decodificarCursor;
module.exports.codificarCursor = codificarCursor;
