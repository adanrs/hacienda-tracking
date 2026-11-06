// Seed de PRUEBA del flujo completo de Hacienda Tempisque, de punta a punta:
//
//   animal → guía de transporte (+ transporte) → sacrificio → marmoleo AUS-MEAT de la canal →
//   solicitud de deshuese → deshuese → reporte de producción (líneas, lote CC → arete, escaneos)
//   → cajas en el inventario de la planta (bodega 107: inventario_planta_cargas / _lineas).
//
// Sirve para probar desde cero (p. ej. el traslado a la tienda y su recepción) sin depender de
// datos reales. Es IDEMPOTENTE: cada entidad se busca por su marcador antes de insertarla, así que
// correrlo dos veces no duplica nada. Todo va en UNA transacción: o queda la cadena completa o nada.
// Para borrarlo: src/seeds/borrar-prueba-flujo.js (borra SOLO por estos marcadores, nunca por id).
//
// Marcadores PRUEBA (elegidos para que no choquen con datos reales y respetando los formatos):
//   animales.numero_trazabilidad      'PRUEBA' (6 caracteres: también es un arete válido para la
//                                     etiqueta de 28 de lib/etiquetas.js); notas = MARCA.
//   guias_transporte.numero           'PRUEBA-GT-001' (las reales son GT-AAAAMMDD-NNN); finca_origen
//                                     'PRUEBA finca', comprador 'PRUEBA'; notas = MARCA.
//   transporte.guia_movilizacion      'PRUEBA-GT-001'; notas = MARCA.
//   sacrificios.lote_sacrificio       'PRUEBA-SAC-001'; numero_canal 'PRUEBA' (cumple ^[0-9A-Z-]{1,10}$).
//   solicitudes_deshuese.numero       0 — el consecutivo real es MAX(numero) + 1 y arranca en 1, así
//                                     que 0 nunca lo emite la app y NO corre la numeración real
//                                     (un número alto haría que la siguiente solicitud real saliera
//                                     con ese número + 1); observaciones = MARCA.
//   deshuese.numero_lote              'PRUEBA-DES-001'; notas = MARCA.
//   reporte_produccion                lote_cc = 9999 y num_lote = '9999': el lote de deshuese es la
//                                     POSICIÓN del animal en el deshuese del día (reales: 1–60 y
//                                     pico); 9999 animales en un día es imposible. archivo_nombre =
//                                     ARCHIVO, notas = MARCA.
//   lotes_cc_aretes                   lote_cc = 9999 + arete 'PRUEBA'.
//   reporte_produccion_escaneos       lote_cc = 9999 (el lote impreso en la etiqueta de la caja).
//   inventario_planta_cargas.archivo  ARCHIVO ('PRUEBA-flujo-completo.xlsx'); las líneas caen por
//                                     cascada. tarima = 'PRUEBA' en cada línea.
//   Cajas CIISA (25 caracteres)       PPPPP GGGGG XXX DDMMAA 9999 07: lote 9999 (= Num. Lote del
//                                     reporte de PRUEBA) y BMS 07 (= marmoleo AUS-MEAT 7 de la canal,
//                                     así la comparación BMS ↔ marmoleo da «coincide»).
//
// Fechas: el deshuese es «hace 3 días» (hora de Costa Rica) la PRIMERA vez que se corre; después
// se reutilizan las fechas de lo ya sembrado (si no, las cajas del día siguiente ya no trazarían al
// reporte del día anterior). Sacrificio = deshuese − 2 días; guía = sacrificio − 1 día. Si ese día
// de sacrificio ya tiene una solicitud de deshuese REAL (llave única por fecha), se corre un día
// hacia atrás hasta encontrar uno libre: el seed nunca toca ni reemplaza una solicitud real.
// Vencimiento de las cajas = fecha del deshuese + 12 meses (lib/vencimiento.js).
//
// Las cajas del inventario 107 se cargan con el MISMO procesador del importador real
// (procesadores/inventarioCiisa.js: planificar + aplicar sobre una tabla «pegada»), así
// `decodificado`, `bms`, trazabilidad, arete, animal_id y reporte_id quedan exactamente como los deja
// una carga de verdad; el seed no duplica esa lógica.
//
// Uso directo (corre initDB primero):
//   node src/seeds/prueba-flujo.js
// En producción (NODE_ENV=production) exige PRUEBA_CONFIRMAR=1. La función exportada no tiene
// guardia (la usan las pruebas).

const { vencimientoDe } = require('../lib/vencimiento');
const { etiquetaParaReporte } = require('../lib/reporteProduccion');
const inventarioCiisa = require('../lib/importador/procesadores/inventarioCiisa');

const MARCA = 'PRUEBA flujo completo';
const ARCHIVO = 'PRUEBA-flujo-completo.xlsx';
const ARETE = 'PRUEBA';
const GUIA = 'PRUEBA-GT-001';
const LOTE_SACRIFICIO = 'PRUEBA-SAC-001';
const CANAL = 'PRUEBA';
const LOTE_DESHUESE_APP = 'PRUEBA-DES-001';
const LOTE = 9999; // Num. Lote del reporte = lote CC = lote impreso en la caja
const SOLICITUD_NUMERO = 0;
const FINCA = 'PRUEBA finca';
const COMPRADOR = 'PRUEBA';
const TARIMA = 'PRUEBA';
const MARMOLEO = 7; // DMs AUS-MEAT de la canal (0–9)
const BMS = 7; // 2 últimos dígitos de cada caja

// Cajas de la hoja «INV GENERAL». Códigos reales del catálogo CIISA (data/catalogo-ciisa.js):
// 3 cortes por kilo y 1 producto que la tienda vende por unidad (tortas, que la planta controla por
// caja: «Medida = Caja», peso 1, igual que las líneas reales de 26636). Picanha va con «PRB» en el
// campo XXX (no es «xxx»: la etiqueta queda completa → con_arete); las demás con «XXX» como las
// reales (trazabilidad perdida → recuperada por fecha + lote).
const CAJAS = [
  { codigo: '26613', descripcion: 'RIBEYE STEAK', kg: 5.12, medida: 'Kilos', xxx: 'XXX' },
  { codigo: '26617', descripcion: 'NEW YORK STEAK', kg: 7.34, medida: 'Kilos', xxx: 'XXX' },
  { codigo: '26606', descripcion: 'SIRLOIN CAP - PICANHA', kg: 4.82, medida: 'Kilos', xxx: 'PRB' },
  { codigo: '26636', descripcion: '1/2 HAMBURGER PATTIES', kg: 1, medida: 'Caja', xxx: 'XXX' },
];

// ── Fechas ───────────────────────────────────────────────────────────────────

/** Hoy en Costa Rica (UTC-6, sin horario de verano) como AAAA-MM-DD. */
const hoyCR = () => new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);

/** AAAA-MM-DD ± n días. */
function sumarDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** AAAA-MM-DD → DDMMAA (fecha de la caja CIISA). */
const ddmmaa = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;

/** Código de barras de caja CIISA: producto 5 · peso en centésimas 5 · XXX 3 · DDMMAA · lote 4 · BMS 2. */
function codigoCaja(c, fechaDeshuese) {
  const centesimas = String(Math.round(c.kg * 100)).padStart(5, '0');
  return `${c.codigo}${centesimas}${c.xxx}${ddmmaa(fechaDeshuese)}${String(LOTE).padStart(4, '0')}${String(BMS).padStart(2, '0')}`;
}

// ── Utilidades de base ───────────────────────────────────────────────────────

/**
 * Busca una fila por su marcador; si no está, la inserta. Devuelve { id, creado }.
 * Se busca antes de insertar (en vez de INSERT IGNORE) porque IGNORE también se traga errores de
 * FK o de truncado y dejaría la cadena rota sin avisar.
 */
async function buscarOCrear(conn, { buscar, params, insertar, valores }) {
  const [filas] = await conn.query(buscar, params);
  if (filas.length) return { id: filas[0].id, creado: false };
  const [r] = await conn.query(insertar, valores);
  return { id: r.insertId, creado: true };
}

/** Fecha (AAAA-MM-DD) de una columna DATE/DATETIME ya sembrada, o null. */
async function fechaExistente(conn, sql, params) {
  const [[f]] = await conn.query(sql, params);
  return f && f.fecha ? String(f.fecha) : null;
}

/**
 * Día de sacrificio libre: solicitudes_deshuese tiene UNA solicitud por fecha. Si el día propuesto
 * ya tiene una solicitud real, se corre hacia atrás (máx. 60 días) para no tocarla.
 */
async function diaSacrificioLibre(conn, propuesto) {
  for (let i = 0; i <= 60; i++) {
    const dia = sumarDias(propuesto, -i);
    const [filas] = await conn.query(
      'SELECT id FROM solicitudes_deshuese WHERE fecha_sacrificio = ? AND NOT (numero = ? AND observaciones = ?)',
      [dia, SOLICITUD_NUMERO, MARCA]);
    if (!filas.length) return dia;
  }
  throw new Error(`No hay un día de sacrificio libre de solicitudes reales en los 60 días previos a ${propuesto}`);
}

// ── Seed ─────────────────────────────────────────────────────────────────────

/**
 * Siembra (o completa) la cadena de PRUEBA. Idempotente.
 * @param {import('mysql2/promise').Pool} pool
 * @param {{ log?: (msg: string) => void }} [opciones]
 * @returns {Promise<object>} resumen con ids, fechas, cajas y qué se creó en esta corrida
 */
async function sembrarPruebaFlujo(pool, { log = () => {} } = {}) {
  const conn = await pool.getConnection();
  const creados = {};
  const marcar = (entidad, r) => { creados[entidad] = r.creado; return r.id; };
  try {
    await conn.beginTransaction();

    // Fechas: las de lo ya sembrado mandan (ver cabecera).
    const fechaDeshuese = await fechaExistente(conn,
      "SELECT DATE_FORMAT(fecha_produccion, '%Y-%m-%d') AS fecha FROM reporte_produccion WHERE lote_cc = ? AND num_lote = ?",
      [LOTE, String(LOTE)]) || sumarDias(hoyCR(), -3);
    const fechaSacrificio = await fechaExistente(conn,
      `SELECT DATE_FORMAT(s.fecha, '%Y-%m-%d') AS fecha FROM sacrificios s JOIN animales a ON a.id = s.animal_id
        WHERE a.numero_trazabilidad = ?`, [ARETE])
      || await diaSacrificioLibre(conn, sumarDias(fechaDeshuese, -2));
    const fechaGuia = sumarDias(fechaSacrificio, -1);
    const vencimiento = vencimientoDe(fechaDeshuese);
    log(`Fechas: guía ${fechaGuia}, sacrificio ${fechaSacrificio}, deshuese ${fechaDeshuese}, vencimiento ${vencimiento}`);

    // 1. Animal (Wagyu F1 macho, ~30 meses al sacrificio).
    const animalId = marcar('animal', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM animales WHERE numero_trazabilidad = ?',
      params: [ARETE],
      insertar: `INSERT INTO animales (numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_actual, estado, finca, notas)
                 VALUES (?, ?, 'bovino', 'Wagyu F1', 'macho', ?, ?, 'sacrificado', ?, ?)`,
      valores: [ARETE, 'PRUEBA', sumarDias(fechaSacrificio, -913), 760, FINCA, MARCA],
    }));

    // 2. Guía de transporte (finca → planta) con su animal y la fila de transporte.
    const guiaId = marcar('guia', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM guias_transporte WHERE numero = ?',
      params: [GUIA],
      insertar: `INSERT INTO guias_transporte (numero, fecha_salida, finca_origen, destino, comprador, tipo_destino, causa_salida,
                   total_animales, peso_total_kg, estado, transportista, placa_vehiculo, guia_movilizacion, notas)
                 VALUES (?, ?, ?, 'CISA COSTA RICA', ?, 'V', 'Venta a planta', 1, 760, 'recibida', 'PRUEBA transportista', 'PRUEBA', ?, ?)`,
      valores: [GUIA, fechaGuia, FINCA, COMPRADOR, GUIA, MARCA],
    }));
    const transporteId = marcar('transporte', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM transporte WHERE animal_id = ? AND guia_movilizacion = ?',
      params: [animalId, GUIA],
      insertar: `INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, fecha_llegada, transportista, placa_vehiculo,
                   guia_movilizacion, estado, notas, guia_id)
                 VALUES (?, 'matadero', 'CISA COSTA RICA', ?, ?, 'PRUEBA transportista', 'PRUEBA', ?, 'recibido', ?, ?)`,
      valores: [animalId, `${fechaGuia} 05:00:00`, `${fechaGuia} 09:00:00`, GUIA, MARCA, guiaId],
    }));
    marcar('guia_animal', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM guia_transporte_animales WHERE guia_id = ? AND animal_id = ?',
      params: [guiaId, animalId],
      insertar: `INSERT INTO guia_transporte_animales (guia_id, animal_id, transporte_id, orden, arete, sexo, raza, fecha_nacimiento,
                   edad_meses, ultimo_peso_kg, causa_salida, tipo_destino, obs_salida, peso_salida_kg)
                 VALUES (?, ?, ?, 1, ?, 'macho', 'Wagyu F1', ?, 30, 760, 'Venta a planta', 'V', ?, 760)`,
      valores: [guiaId, animalId, transporteId, ARETE, sumarDias(fechaSacrificio, -913), MARCA],
    }));

    // 3. Sacrificio con el marmoleo AUS-MEAT de la canal (como lo deja la carga de la cámara).
    const marmoleoExtra = { dmp: 6.8, nfi2: null, dma: 92.5, dms: MARMOLEO, dms_msa: 690, dmc: null, barcode: null, body: CANAL, prueba: MARCA };
    const sacrificioId = marcar('sacrificio', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM sacrificios WHERE animal_id = ?',
      params: [animalId],
      insertar: `INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, rendimiento_canal,
                   marmoleo, ojo_ribeye_cm2, fecha_marmoleo, fecha_colgado, inspector, resultado_inspeccion, lote_sacrificio,
                   numero_canal, guia_id, grasa, rendimiento_informado, marmoleo_extra, notas)
                 VALUES (?, ?, 760, 456, 447, 60.00, ?, 92.50, ?, ?, 'PRUEBA inspector', 'aprobado', ?, ?, ?, 3, 60.00, ?, ?)`,
      valores: [animalId, `${fechaSacrificio} 06:30:00`, MARMOLEO, `${sumarDias(fechaSacrificio, 1)} 10:00:00`,
        `${fechaSacrificio} 07:00:00`, LOTE_SACRIFICIO, CANAL, guiaId, JSON.stringify(marmoleoExtra), MARCA],
    }));

    // 4. Solicitud de deshuese de ese día (una canal, las dos medias de cada corte).
    const solicitudId = marcar('solicitud', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM solicitudes_deshuese WHERE numero = ? AND observaciones = ?',
      params: [SOLICITUD_NUMERO, MARCA],
      insertar: `INSERT INTO solicitudes_deshuese (numero, fecha_sacrificio, estado, observaciones, enviada_en, enviada_a)
                 VALUES (?, ?, 'con_reporte', ?, ?, 'PRUEBA')`,
      valores: [SOLICITUD_NUMERO, fechaSacrificio, MARCA, `${sumarDias(fechaSacrificio, 1)} 08:00:00`],
    }));
    const canalId = marcar('solicitud_canal', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM solicitud_canales WHERE sacrificio_id = ?',
      params: [sacrificioId],
      insertar: 'INSERT INTO solicitud_canales (solicitud_id, sacrificio_id, numero_canal, orden, peso_deshuese_est) VALUES (?, ?, ?, 1, ?)',
      valores: [solicitudId, sacrificioId, CANAL, Math.round(447 * 0.84 * 100) / 100],
    }));
    for (const [i, c] of CAJAS.entries()) {
      marcar(`solicitud_linea_${c.codigo}`, await buscarOCrear(conn, {
        buscar: "SELECT id FROM solicitud_lineas WHERE solicitud_canal_id = ? AND corte_codigo = ? AND corte_informado = ''",
        params: [canalId, c.codigo],
        insertar: 'INSERT INTO solicitud_lineas (solicitud_id, corte_codigo, solicitud_canal_id, medias, observacion, orden) VALUES (?, ?, ?, 2, ?, ?)',
        valores: [solicitudId, c.codigo, canalId, MARCA, i + 1],
      }));
    }

    // 5. Deshuese (registro de la app).
    const deshueseId = marcar('deshuese', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM deshuese WHERE numero_lote = ?',
      params: [LOTE_DESHUESE_APP],
      insertar: `INSERT INTO deshuese (numero_lote, sacrificio_id, animal_id, fecha, peso_entrada, responsable, estado, notas)
                 VALUES (?, ?, ?, ?, 447, 'PRUEBA', 'cerrado', ?)`,
      valores: [LOTE_DESHUESE_APP, sacrificioId, animalId, `${fechaDeshuese} 08:00:00`, MARCA],
    }));

    // 6. Reporte de producción de CIISA: encabezado, líneas, lote CC → arete y escaneos.
    const kgTotal = Math.round(CAJAS.reduce((s, c) => s + c.kg, 0) * 100) / 100;
    const reporteId = marcar('reporte', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM reporte_produccion WHERE lote_cc = ? AND num_lote = ?',
      params: [LOTE, String(LOTE)],
      insertar: `INSERT INTO reporte_produccion (fecha_produccion, lote_cc, num_lote, tipo_produccion, origen, archivo_nombre, notas,
                   pie_kilos, pie_libras, pie_cajas)
                 VALUES (?, ?, ?, 'TEMPISQUE', 'manual', ?, ?, ?, ?, ?)`,
      valores: [fechaDeshuese, LOTE, String(LOTE), ARCHIVO, MARCA, kgTotal, Math.round(kgTotal * 2.20462 * 100) / 100, CAJAS.length],
    }));
    for (const [i, c] of CAJAS.entries()) {
      marcar(`reporte_linea_${c.codigo}`, await buscarOCrear(conn, {
        buscar: 'SELECT id FROM reporte_produccion_lineas WHERE reporte_id = ? AND linea = ?',
        params: [reporteId, i + 1],
        insertar: `INSERT INTO reporte_produccion_lineas (reporte_id, linea, articulo_codigo, descripcion, peso_kg, unidad, cajas)
                   VALUES (?, ?, ?, ?, ?, 'KGS', 1)`,
        valores: [reporteId, i + 1, c.codigo, c.descripcion, c.kg],
      }));
    }
    const loteAreteId = marcar('lote_cc_arete', await buscarOCrear(conn, {
      buscar: 'SELECT id FROM lotes_cc_aretes WHERE fecha_deshuese = ? AND lote_cc = ?',
      params: [fechaDeshuese, LOTE],
      insertar: 'INSERT INTO lotes_cc_aretes (fecha_deshuese, lote_cc, arete, animal_id, deshuese_id) VALUES (?, ?, ?, ?, ?)',
      valores: [fechaDeshuese, LOTE, ARETE, animalId, deshueseId],
    }));

    // Escaneos de las cajas en la app, con la misma lectura que usa POST /reporte-produccion/escaneos.
    const cajas = CAJAS.map((c) => ({ ...c, codigo_barras: codigoCaja(c, fechaDeshuese) }));
    for (const c of cajas) {
      const r = etiquetaParaReporte(c.codigo_barras, 'caja');
      if (!r.ok) throw new Error(`La caja de PRUEBA ${c.codigo_barras} no decodifica: ${r.mensaje}`);
      const e = r.etiqueta;
      marcar(`escaneo_${c.codigo}`, await buscarOCrear(conn, {
        buscar: 'SELECT id FROM reporte_produccion_escaneos WHERE codigo_crudo = ? AND copia = 1',
        params: [e.codigo_crudo],
        insertar: `INSERT INTO reporte_produccion_escaneos
                     (codigo_crudo, copia, tipo, articulo_codigo, peso_kg, fecha_deshuese, lote_cc, box_codigo, sufijo, bms, fecha_ambigua, decodificado)
                   VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        valores: [e.codigo_crudo, e.tipo, e.articulo_codigo, e.peso_kg, e.fecha_deshuese, e.lote_cc, e.box_codigo, e.sufijo, e.bms,
          e.fecha_ambigua ? 1 : 0, JSON.stringify(e.decodificado)],
      }));
    }

    // 7. Inventario de la planta (bodega 107): una carga con las 4 cajas, por el procesador real.
    let cargaId;
    const [[cargaPrevia]] = await conn.query('SELECT id FROM inventario_planta_cargas WHERE archivo = ? ORDER BY id LIMIT 1', [ARCHIVO]);
    if (cargaPrevia) {
      cargaId = marcar('inventario_carga', { id: cargaPrevia.id, creado: false });
    } else {
      const fv = vencimiento.split('-').reverse().join('/');
      const texto = [
        'Tarima\tLinea\tCod Barra\tCodigo\tDescripción\tPeso\tMedida\tLote\tFecha Vencimiento',
        ...cajas.map((c, i) => [TARIMA, i + 1, c.codigo_barras, c.codigo, c.descripcion, c.kg, c.medida,
          `${ddmmaa(fechaDeshuese)}${String(LOTE).padStart(4, '0')}`, fv].join('\t')),
      ].join('\n');
      const plan = await inventarioCiisa.planificar(conn, null, { fecha_inventario: hoyCR() },
        { lectura: { documentos: [{ pegado: true, texto, nombre: ARCHIVO }] } });
      const malas = plan.filas.filter((f) => f.accion === 'error' || !['con_arete', 'recuperada'].includes(f.trazabilidad) || f.animal_id !== animalId);
      if (plan.errores_generales.length || malas.length) {
        throw new Error(`El inventario de PRUEBA no trazó al animal: ${[...plan.errores_generales,
          ...malas.map((f) => `${f.codigo_barras}: ${f.trazabilidad} ${f.traz_motivo || ''} ${f.errores.join('; ')}`)].join(' | ')}`);
      }
      // La huella (contenido_sha256, UNIQUE) sale de las líneas: es determinista para las mismas
      // fechas. Si ya existiera (otra carga con el mismo contenido) aplicar no inserta otra.
      plan.archivo_nombre = ARCHIVO;
      const r = await inventarioCiisa.aplicar(conn, plan, { importacionId: null, usuarioId: null, registrar: () => {} });
      cargaId = marcar('inventario_carga', { id: r.resumen.carga_id, creado: !r.resumen.ya_cargado });
    }
    const [lineas] = await conn.query(
      `SELECT id, codigo_barras, codigo, descripcion, peso, medida, lote, DATE_FORMAT(fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
              bms, trazabilidad, arete, animal_id, reporte_id
         FROM inventario_planta_lineas WHERE carga_id = ? ORDER BY id`, [cargaId]);

    await conn.commit();
    const resumen = {
      arete: ARETE,
      num_lote: String(LOTE),
      fechas: { guia: fechaGuia, sacrificio: fechaSacrificio, deshuese: fechaDeshuese, vencimiento },
      ids: {
        animal: animalId, guia: guiaId, transporte: transporteId, sacrificio: sacrificioId, solicitud: solicitudId,
        solicitud_canal: canalId, deshuese: deshueseId, reporte: reporteId, lote_cc_arete: loteAreteId, inventario_carga: cargaId,
      },
      cajas: lineas.map((l) => ({ ...l, peso: Number(l.peso), bms: l.bms == null ? null : Number(l.bms) })),
      creados: Object.keys(creados).filter((k) => creados[k]),
    };
    log(`Seed PRUEBA: ${resumen.creados.length ? `creado ${resumen.creados.join(', ')}` : 'ya estaba completo, nada nuevo'}`);
    return resumen;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = {
  sembrarPruebaFlujo, codigoCaja,
  MARCA, ARCHIVO, ARETE, GUIA, LOTE_SACRIFICIO, CANAL, LOTE_DESHUESE_APP, LOTE, SOLICITUD_NUMERO,
};

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && process.env.PRUEBA_CONFIRMAR !== '1') {
    console.error('NODE_ENV=production: este seed escribe datos de PRUEBA en la base. Si es a propósito, repita con PRUEBA_CONFIRMAR=1.');
    process.exit(1);
  }
  const { pool, initDB } = require('../models/database');
  (async () => {
    try {
      await initDB();
      const r = await sembrarPruebaFlujo(pool, { log: (m) => console.log(m) });
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error(`Seed de PRUEBA falló (no quedó nada a medias: se revirtió): ${e.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}
