// Migración aditiva e idempotente: traslados planta (bodega 107) → tienda (WC-01) y su recepción.
//
// Se llama al final de initDB (database.js), después de migrarInventarioPlanta: necesita la tabla
// inventario_planta_lineas para la FK.
//
// Por qué sobre `ordenes_salida` y no una tabla nueva de traslados: la orden de salida con destino
// WC-01 ya es lo que la tienda consulta por la integración (GET /despachos, con su cursor y su
// candado de despacho). Una orden de traslado a la tienda es esa misma orden, pero sus líneas son
// CAJAS DEL INVENTARIO DE LA PLANTA (snapshot del Excel semanal de CIISA), no cajas internas de la
// app. Por eso cada ítem guarda una COPIA de la línea (código de barras, artículo, peso, lote, BMS,
// arete): el snapshot de la semana siguiente no trae la caja que ya salió, y la orden no puede
// depender de que la línea siga existiendo.
//
//   ordenes_salida.es_prueba          1 = datos de PRUEBA (seed de flujo completo). En el modo
//                                     «pruebas» de la integración solo estas órdenes se exponen y
//                                     se aplican; el borrado de prueba las elimina.
//   ordenes_salida.recepcion_*        resumen de lo que la tienda informó al recibir (evento
//                                     traslado.recibido): estado, cuándo, quién.
//   ordenes_salida_items.inventario_linea_id + copia de la línea (ver arriba).
//   recepciones_tienda                una fila por evento traslado.recibido aplicado.
//   recepciones_tienda_cajas          el resultado de cada caja: recibida, faltante, sobrante u
//                                     otro peso, con la acción (devolver en el mismo transporte /
//                                     avisar a la planta) y el motivo que exige Juan Carlos.

async function columna(conn, sql) {
  try { await conn.query(sql); } catch (e) {
    // ER_DUP_FIELDNAME / ER_DUP_KEYNAME / ER_FK_DUP_NAME: ya estaba (arranque normal).
    if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME', 'ER_DUP_KEY', 'ER_CANT_CREATE_TABLE'].includes(e.code) && !/Duplicate/i.test(e.message)) {
      console.error(`[initDB traslados tienda] ${e.code || 'ERROR'}: ${e.message}`);
    }
  }
}

async function migrarTrasladosTienda(conn) {
  await columna(conn, "ALTER TABLE ordenes_salida ADD COLUMN es_prueba TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = datos de PRUEBA (seed de flujo completo)'");
  await columna(conn, "ALTER TABLE ordenes_salida ADD COLUMN recepcion_estado ENUM('recibida','recibida_con_diferencias') NULL COMMENT 'Lo que informó la tienda al recibir (traslado.recibido)'");
  await columna(conn, "ALTER TABLE ordenes_salida ADD COLUMN recepcion_en DATETIME NULL COMMENT 'Cuándo cerró la recepción la tienda'");
  await columna(conn, "ALTER TABLE ordenes_salida ADD COLUMN recepcion_por VARCHAR(160) NULL COMMENT 'Quién recibió en la tienda (origen.usuario del evento)'");

  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN inventario_linea_id INT NULL COMMENT 'Línea del inventario de la planta (107) de donde salió la caja'");
  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN codigo_barras VARCHAR(40) NULL COMMENT 'Código CIISA de la caja (copia de la línea del inventario)'");
  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN codigo_articulo VARCHAR(10) NULL COMMENT 'Código de producto CIISA de la caja'");
  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN descripcion VARCHAR(150) NULL");
  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN lote VARCHAR(20) NULL");
  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN bms TINYINT UNSIGNED NULL COMMENT 'BMS de la caja (2 últimos dígitos del código)'");
  await columna(conn, "ALTER TABLE ordenes_salida_items ADD COLUMN arete VARCHAR(20) NULL COMMENT 'Arete al que traza la caja (nunca el xxx literal)'");
  await columna(conn, 'ALTER TABLE ordenes_salida_items ADD INDEX idx_osi_codigo_barras (codigo_barras)');
  await columna(conn, 'ALTER TABLE ordenes_salida_items ADD CONSTRAINT fk_osi_inv_linea FOREIGN KEY (inventario_linea_id) REFERENCES inventario_planta_lineas(id) ON DELETE SET NULL');

  // Carga del inventario de la planta marcada PRUEBA (seed de flujo completo): no cuenta como «el
  // último snapshot» real ni entra en la comparación semana a semana. Las cargas del seed que ya
  // existan se marcan por su nombre de archivo.
  await columna(conn, "ALTER TABLE inventario_planta_cargas ADD COLUMN es_prueba TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = snapshot de PRUEBA (no es el último real)'");
  try { await conn.query("UPDATE inventario_planta_cargas SET es_prueba = 1 WHERE archivo = 'PRUEBA-flujo-completo.xlsx' AND es_prueba = 0"); } catch (e) { /* sin la columna */ }

  // La integración ahora también registra eventos en el modo «pruebas».
  await columna(conn, "ALTER TABLE integracion_eventos MODIFY COLUMN modo ENUM('sombra','encendido','pruebas') NOT NULL COMMENT 'Modo de la integración al recibirlo (sombra = solo se validó)'");

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS recepciones_tienda (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orden_id INT NULL COMMENT 'Orden de salida recibida (NULL = la tienda recibió sin orden)',
        numero_orden VARCHAR(50) NULL COMMENT 'Número tal como lo mandó la tienda',
        evento_clave VARCHAR(160) NOT NULL COMMENT 'traslado.recibido:<recepcion_id de la tienda>',
        recepcion_tienda VARCHAR(64) NOT NULL COMMENT 'Id de la recepción en la tienda',
        estado ENUM('recibida','recibida_con_diferencias') NOT NULL,
        recibida_por VARCHAR(160) NULL COMMENT 'Quién cerró la recepción en la tienda',
        cerrada_en DATETIME NULL COMMENT 'Cuándo la cerró la tienda',
        registrada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Cuándo llegó a ganadería',
        cajas_recibidas INT NOT NULL DEFAULT 0,
        cajas_faltantes INT NOT NULL DEFAULT 0,
        cajas_sobrantes INT NOT NULL DEFAULT 0,
        cajas_otro_peso INT NOT NULL DEFAULT 0,
        kg_esperado DECIMAL(10,3) NULL,
        kg_recibido DECIMAL(10,3) NULL,
        UNIQUE KEY uq_rt_evento (evento_clave),
        INDEX idx_rt_orden (orden_id),
        FOREIGN KEY (orden_id) REFERENCES ordenes_salida(id) ON DELETE CASCADE
      ) COMMENT='Recepciones de traslados informadas por la tienda (traslado.recibido)'
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS recepciones_tienda_cajas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        recepcion_id INT NOT NULL,
        item_id INT NULL COMMENT 'Ítem de la orden (NULL = caja sobrante, no estaba en la orden)',
        codigo VARCHAR(64) NOT NULL COMMENT 'Código CIISA normalizado de la caja',
        resultado ENUM('recibida','faltante','sobrante','otro_peso') NOT NULL,
        kg_esperado DECIMAL(10,3) NULL,
        kg_recibido DECIMAL(10,3) NULL,
        accion ENUM('devolver_mismo_transporte','avisar_planta') NULL COMMENT 'Qué hizo la tienda con la diferencia',
        motivo VARCHAR(300) NULL,
        INDEX idx_rtc_recepcion (recepcion_id),
        INDEX idx_rtc_codigo (codigo),
        FOREIGN KEY (recepcion_id) REFERENCES recepciones_tienda(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES ordenes_salida_items(id) ON DELETE SET NULL
      ) COMMENT='Resultado por caja de cada recepción en la tienda'
    `);
  } catch (e) {
    console.error(`[initDB traslados tienda] ${e.code || 'ERROR'}: ${e.message} — la recepción de traslados de la tienda NO se va a registrar hasta corregirlo`);
  }
}

module.exports = { migrarTrasladosTienda };
