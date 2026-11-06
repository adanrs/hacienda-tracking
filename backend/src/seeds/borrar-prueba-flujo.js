// Borra TODO lo que siembra src/seeds/prueba-flujo.js, y lo que el flujo de traslado a la tienda
// haya colgado de esos datos (órdenes de salida de PRUEBA, sus recepciones y eventos).
//
// Identifica las filas SOLO por los marcadores PRUEBA (ver la cabecera de prueba-flujo.js), nunca
// por rangos de id: un dato real no puede caer aunque los ids se intercalen. Todo en UNA
// transacción; si algo falla se revierte entero. Borrar dos veces no falla (la segunda borra 0).
//
// Orden (los hijos antes que los padres, para no depender de que cada FK tenga cascada):
//   a) eventos de integración de las recepciones de órdenes de PRUEBA;
//   b) órdenes de salida con es_prueba = 1 (sus ítems y recepciones_tienda caen por cascada:
//      ordenes_salida_items.orden_id y recepciones_tienda.orden_id son ON DELETE CASCADE);
//   c) lo del seed: inventario 107, escaneos, lote CC → arete, reporte, solicitud, deshuese,
//      sacrificio, transporte, guía y por último el animal.
// Los pasos a) y b) toleran que la columna o la tabla todavía no existan (ER_BAD_FIELD_ERROR /
// ER_NO_SUCH_TABLE): la migración de traslados a la tienda puede no haber corrido en esa base.
//
// Uso directo (corre initDB primero):
//   node src/seeds/borrar-prueba-flujo.js
// En producción (NODE_ENV=production) exige PRUEBA_CONFIRMAR=1.

const {
  MARCA, ARCHIVO, ARETE, GUIA, LOTE_SACRIFICIO, LOTE_DESHUESE_APP, LOTE, SOLICITUD_NUMERO,
} = require('./prueba-flujo');

const TOLERADOS = ['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'];

/**
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<Record<string, number>>} filas borradas por paso (lo que cae por cascada no se cuenta)
 */
async function borrarPruebaFlujo(pool) {
  const conn = await pool.getConnection();
  const borradas = {};
  const paso = async (nombre, sql, params = [], tolerar = false) => {
    try {
      const [r] = await conn.query(sql, params);
      borradas[nombre] = r.affectedRows;
    } catch (e) {
      if (!tolerar || !TOLERADOS.includes(e.code)) throw e;
      borradas[nombre] = 0; // la tabla o columna aún no existe en esta base: no hay nada que borrar
    }
  };
  try {
    await conn.beginTransaction();

    // a) + b) Lo que el traslado a la tienda colgó de los datos de PRUEBA.
    await paso('integracion_eventos',
      `DELETE FROM integracion_eventos WHERE clave IN (
         SELECT evento_clave FROM recepciones_tienda r JOIN ordenes_salida o ON o.id = r.orden_id WHERE o.es_prueba = 1)`, [], true);
    await paso('ordenes_salida', 'DELETE FROM ordenes_salida WHERE es_prueba = 1', [], true);

    // c) Lo del seed. Las líneas del inventario caen con su carga; las de reporte con su reporte.
    await paso('inventario_planta_cargas', 'DELETE FROM inventario_planta_cargas WHERE archivo = ?', [ARCHIVO]);
    await paso('reporte_produccion_escaneos', 'DELETE FROM reporte_produccion_escaneos WHERE lote_cc = ?', [LOTE]);
    await paso('lotes_cc_aretes', 'DELETE FROM lotes_cc_aretes WHERE lote_cc = ? AND arete = ?', [LOTE, ARETE]);
    await paso('reporte_produccion', 'DELETE FROM reporte_produccion WHERE lote_cc = ? AND num_lote = ?', [LOTE, String(LOTE)]);
    // numero 0 nunca lo emite la app (MAX + 1 arranca en 1); también por la observación, por si
    // alguien renumeró la de PRUEBA. Canales y líneas caen por cascada.
    await paso('solicitudes_deshuese', 'DELETE FROM solicitudes_deshuese WHERE numero = ? OR observaciones = ?', [SOLICITUD_NUMERO, MARCA]);
    await paso('deshuese', 'DELETE FROM deshuese WHERE numero_lote = ?', [LOTE_DESHUESE_APP]);
    await paso('sacrificios', 'DELETE FROM sacrificios WHERE lote_sacrificio = ?', [LOTE_SACRIFICIO]);
    await paso('transporte', 'DELETE FROM transporte WHERE guia_movilizacion = ?', [GUIA]);
    await paso('guias_transporte', 'DELETE FROM guias_transporte WHERE numero = ?', [GUIA]);
    // El animal al final: lo que quedara colgado de él (pesajes, sacrificio, deshuese…) cae por cascada.
    await paso('animales', 'DELETE FROM animales WHERE numero_trazabilidad = ?', [ARETE]);

    await conn.commit();
    return borradas;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { borrarPruebaFlujo };

if (require.main === module) {
  if (process.env.NODE_ENV === 'production' && process.env.PRUEBA_CONFIRMAR !== '1') {
    console.error('NODE_ENV=production: esto borra los datos de PRUEBA de la base. Si es a propósito, repita con PRUEBA_CONFIRMAR=1.');
    process.exit(1);
  }
  const { pool, initDB } = require('../models/database');
  (async () => {
    try {
      await initDB();
      const r = await borrarPruebaFlujo(pool);
      console.log('Datos de PRUEBA borrados (filas por paso; lo que cae por cascada no se cuenta):');
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error(`Borrado de PRUEBA falló (se revirtió, no se borró nada): ${e.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}
