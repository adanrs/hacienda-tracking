// Migración aditiva e idempotente: inventario semanal de la planta CIISA (bodega 107 / paquetería).
//
// Se llama al final de initDB (database.js), después de migrarProduccionCatalogo. Solo crea tablas
// nuevas (CREATE TABLE IF NOT EXISTS): no toca datos existentes.
//
// Por qué dos tablas y no «actualizar el inventario»: lo que manda la planta es una FOTO de lo que
// tiene en bodega esa semana (Excel «INV WAGYU SEMANA nn»). Cada carga es un snapshot completo que
// no modifica las anteriores; la comparación entre dos snapshots (altas / bajas) dice qué salió o
// entró. Es la base para pedirle cajas a la planta (solicitudes de traslado, otro PR).
//
//   inventario_planta_cargas  → una por archivo cargado: cuándo, de qué inventario, quién, totales.
//                               `contenido_sha256` (huella de las LÍNEAS leídas, no del archivo) es
//                               única: el mismo inventario subido dos veces —aunque cambie el nombre
//                               del archivo o venga pegado— no crea otro snapshot.
//   inventario_planta_lineas  → una por fila de las hojas «INV GENERAL» y «MADURACION», tal como las
//                               trae la planta, más la lectura del código de barras y la trazabilidad.

async function migrarInventarioPlanta(conn) {
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventario_planta_cargas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha_carga DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Cuándo se cargó en la app',
        fecha_inventario DATE NULL COMMENT 'Día del inventario según el usuario (la planta no lo pone en el archivo)',
        archivo VARCHAR(255) NULL COMMENT 'Nombre del archivo (o NULL si se pegó la tabla)',
        contenido_sha256 CHAR(64) NOT NULL COMMENT 'Huella de las líneas leídas: el mismo inventario no se carga dos veces',
        quien INT NULL COMMENT 'Usuario que aplicó la carga',
        importacion_id INT NULL COMMENT 'Registro del importador (importaciones.id) con su bitácora',
        resumen JSON NULL COMMENT 'Totales por hoja: piezas, kg, trazabilidad, vencidos',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ipc_contenido (contenido_sha256),
        INDEX idx_ipc_fecha (fecha_carga),
        FOREIGN KEY (quien) REFERENCES usuarios(id) ON DELETE SET NULL
      ) COMMENT='Snapshots del inventario semanal que manda la planta CIISA'
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS inventario_planta_lineas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        carga_id INT NOT NULL,
        hoja ENUM('general','maduracion') NOT NULL COMMENT 'general = «INV GENERAL»; maduracion = «MADURACION» (custodia en maduración)',
        fila INT NULL COMMENT 'Fila de la hoja (para ubicarla en el Excel de la planta)',
        tarima VARCHAR(20) NULL,
        linea INT NULL,
        codigo_barras VARCHAR(40) NULL COMMENT 'Código de barras tal cual; NULL si la planta puso «SIN CODIGO DE BARRAS» (maduración no lo trae)',
        codigo VARCHAR(10) NULL COMMENT 'Código de producto CIISA o Arreo (sin FK: puede no estar en el catálogo)',
        descripcion VARCHAR(150) NULL,
        caja VARCHAR(20) NULL COMMENT 'N.º de caja (Box) de la hoja MADURACION',
        peso DECIMAL(10,3) NULL,
        medida VARCHAR(20) NULL COMMENT 'Kilos | Caja | UND tal como lo trae la planta (NULL = kilos)',
        lote VARCHAR(20) NULL COMMENT 'Lote como lo trae la hoja (en maduración se completa a 8 dígitos MMDDAA+lote)',
        fecha_vencimiento DATE NULL,
        vencido TINYINT(1) NOT NULL DEFAULT 0,
        despacho VARCHAR(60) NULL,
        fecha_despacho DATE NULL,
        pedido_por VARCHAR(80) NULL,
        orden VARCHAR(40) NULL,
        estatus VARCHAR(60) NULL COMMENT 'ESTATUS de la hoja MADURACION (p. ej. «Facturar Arreo»)',
        decodificado JSON NULL COMMENT 'Lectura del código de barras (lib/etiquetas.js) o del lote de maduración',
        trazabilidad ENUM('con_arete','recuperada','sin_trazabilidad','na') NOT NULL DEFAULT 'na'
          COMMENT 'con_arete: la etiqueta está completa y su lote lleva a un arete; recuperada: traía «xxx» y se recuperó por fecha + lote; sin_trazabilidad: no se llega a un animal; na: sin código ni lote legible',
        arete VARCHAR(20) NULL COMMENT 'Arete al que lleva la trazabilidad (nunca el «xxx» literal)',
        animal_id INT NULL,
        reporte_id INT NULL COMMENT 'Reporte de producción que respalda el arete',
        INDEX idx_ipl_carga (carga_id, hoja, tarima),
        INDEX idx_ipl_clave (carga_id, codigo_barras, lote),
        INDEX idx_ipl_codigo (codigo),
        FOREIGN KEY (carga_id) REFERENCES inventario_planta_cargas(id) ON DELETE CASCADE
      ) COMMENT='Líneas de cada snapshot del inventario de la planta'
    `);
  } catch (e) {
    console.error(`[initDB inventario planta] ${e.code || 'ERROR'}: ${e.message} — la carga del inventario de la planta NO va a funcionar hasta corregirlo`);
  }
  // BMS de la línea (Juan Carlos, 06-nov-2026): los 2 últimos dígitos del código de caja (o de la
  // bolsa) son el BMS, 0–12. Columna aparte para filtrar y comparar con el marmoleo del animal; el
  // JSON `decodificado` lo sigue trayendo. Las líneas cargadas antes lo tienen como `sufijo` (caja)
  // o `marmoleo` (bolsa) en ese JSON: se copia una sola vez donde `bms` está vacío.
  try { await conn.query("ALTER TABLE inventario_planta_lineas ADD COLUMN bms TINYINT UNSIGNED NULL COMMENT 'BMS de la caja o bolsa (2 últimos dígitos del código, 0–12)' AFTER decodificado"); } catch (e) {}
  try {
    await conn.query(
      `UPDATE inventario_planta_lineas
          SET bms = CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.marmoleo')), JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.sufijo'))) AS UNSIGNED)
        WHERE bms IS NULL
          AND JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.tipo')) IN ('caja', 'paquete')
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.marmoleo')), JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.sufijo'))) REGEXP '^[0-9]{1,2}$'
          AND CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.marmoleo')), JSON_UNQUOTE(JSON_EXTRACT(decodificado, '$.sufijo'))) AS UNSIGNED) <= 12`);
  } catch (e) {
    console.error(`[initDB inventario planta bms] ${e.code || 'ERROR'}: ${e.message}`);
  }
}

module.exports = { migrarInventarioPlanta };
