// Migración aditiva e idempotente: catálogo de cortes en BD, reporte de producción por animal
// (PDF de CIISA) y solicitud de deshuese «con reporte».
//
// Se llama al final de initDB (database.js), después de migrarImportaciones. Igual que el resto:
// solo se tolera «ya existe» (re-arranque); cualquier otro error queda en el log con su consecuencia.
//
// Qué agrega o cambia:
//   catalogo_cortes.tipo        → suma 'subprimal', 'hueso' y 'trimming' (los valores viejos siguen
//                                 valiendo: hay filas y stickers que los usan).
//   catalogo_cortes_bitacora    → quién creó, cambió, desactivó o reasignó cada código y qué cambió.
//   catalogo_cortes (datos)     → siembra los códigos del archivo que FALTEN (no pisa lo editado en
//                                 pantalla), el genérico 99 «Corte pendiente de codificar», y pasa
//                                 11163 y 22229 a trimming (materia prima de molida).
//   reporte_produccion          → origen 'pdf', totales del pie tal como los imprime CIISA, archivo
//                                 PDF guardado e importación que lo cargó.
//   reporte_produccion_lineas   → codigo_informado: el código que traía la planta cuando la línea
//                                 quedó en 99 (pendiente). La llave única pasa a incluirlo, para que
//                                 un reporte pueda tener varias líneas pendientes distintas.
//   solicitud_lineas            → corte_informado: igual, para solicitudes históricas con filas sin
//                                 código (Grasa rinodada, Lengua…).
//   solicitudes_deshuese.estado → suma 'con_reporte' (todas sus canales tienen reporte de producción).

const { CATALOGO_CIISA } = require('../data/catalogo-ciisa');
const { CODIGO_PENDIENTE, NOMBRE_PENDIENTE } = require('../lib/catalogoCortes');

const TIPOS_CORTE = ['primal', 'subprimal', 'hueso', 'subproducto', 'trimming', 'retail', 'grasa', 'trim', 'bch', 'otro'];

async function migrarProduccionCatalogo(conn) {
  const ignorar = async (sql, consecuencia, codigosOk = []) => {
    try { await conn.query(sql); } catch (e) {
      if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', ...codigosOk].includes(e.code)) return;
      console.error(`[initDB produccion/catalogo] ${e.code || 'ERROR'}: ${e.message}${consecuencia ? ` — ${consecuencia}` : ''}`);
    }
  };
  const SIN_CATALOGO = 'el catálogo de cortes editable NO va a funcionar hasta corregirlo';
  const SIN_REPORTE = 'la importación del reporte de producción NO va a funcionar hasta corregirlo';

  // MODIFY con la lista completa: MySQL solo reescribe la definición (agregar valores al final de
  // un ENUM no toca los datos).
  await ignorar(`ALTER TABLE catalogo_cortes MODIFY COLUMN tipo ENUM(${TIPOS_CORTE.map((t) => `'${t}'`).join(',')}) DEFAULT 'primal'`, SIN_CATALOGO);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS catalogo_cortes_bitacora (
      id INT AUTO_INCREMENT PRIMARY KEY,
      corte_id INT NULL,
      codigo VARCHAR(20) NOT NULL COMMENT 'Código al momento del cambio (sobrevive aunque se edite)',
      accion VARCHAR(20) NOT NULL COMMENT 'creado, editado, desactivado, activado, reasignado, importado',
      detalle JSON NULL COMMENT 'Cambios antes → después, o qué registros se reasignaron',
      origen VARCHAR(20) NOT NULL DEFAULT 'pantalla' COMMENT 'pantalla, alta_rapida, importacion, pendientes, semilla',
      importacion_id INT NULL,
      usuario_id INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ccb_corte (corte_id, created_at),
      INDEX idx_ccb_codigo (codigo),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    ) COMMENT='Bitácora de cambios del catálogo de cortes'
  `);

  // Semilla: solo los códigos que no existen. El seed completo (npm run seed) sigue actualizando
  // todo desde el archivo; al arrancar NO se pisa lo que el dueño corrigió en la pantalla.
  const columnas = ['codigo', 'nombre', 'nombre_en', 'tipo', 'serie', 'genetica', 'codigo_equivalente', 'unidad',
    'vida_util_dias', 'vida_congelado_dias', 'ventana_min_dias', 'ventana_max_dias', 'nota_enlace', 'notas'];
  try {
    const [nuevos] = await conn.query(
      `INSERT IGNORE INTO catalogo_cortes (${columnas.join(', ')}) VALUES ${CATALOGO_CIISA.map(() => `(${columnas.map(() => '?').join(', ')})`).join(', ')}`,
      CATALOGO_CIISA.flatMap((c) => columnas.map((col) => (c[col] === undefined ? null : c[col]))),
    );
    if (nuevos.affectedRows) console.log(`Catálogo de cortes: ${nuevos.affectedRows} códigos del archivo sembrados en la base`);
    await conn.query(
      `INSERT IGNORE INTO catalogo_cortes (codigo, nombre, tipo, unidad, activo, notas)
       VALUES (?, ?, 'otro', 'kg', 1, 'Genérico: líneas que la planta trae sin código conocido; se reasignan al código real en «Pendientes de codificar»')`,
      [CODIGO_PENDIENTE, NOMBRE_PENDIENTE],
    );
    // 11163 / 22229 → trimming (antes 'trim' / 'bch'). Solo si siguen con el tipo viejo: si el
    // dueño ya los cambió en pantalla, se respeta.
    await conn.query(
      `UPDATE catalogo_cortes SET tipo = 'trimming' WHERE (codigo = '11163' AND tipo = 'trim') OR (codigo = '22229' AND tipo = 'bch')`,
    );
  } catch (e) {
    console.error(`[initDB produccion/catalogo] ${e.code || 'ERROR'}: ${e.message} — ${SIN_CATALOGO}`);
  }

  await ignorar(`ALTER TABLE reporte_produccion MODIFY COLUMN origen ENUM('excel_csv','manual','pegado','json','pdf') NOT NULL DEFAULT 'manual' COMMENT 'Cómo se capturó'`, SIN_REPORTE);
  await ignorar(`ALTER TABLE reporte_produccion ADD COLUMN pie_kilos DECIMAL(10,2) NULL COMMENT 'Kilos del pie «Total de Cajas por el Lote» tal como los imprime CIISA'`, SIN_REPORTE);
  await ignorar(`ALTER TABLE reporte_produccion ADD COLUMN pie_libras DECIMAL(10,2) NULL COMMENT 'Libras del pie tal como las imprime CIISA'`, SIN_REPORTE);
  await ignorar(`ALTER TABLE reporte_produccion ADD COLUMN pie_cajas INT NULL COMMENT 'Cajas del pie tal como las imprime CIISA'`, SIN_REPORTE);
  await ignorar(`ALTER TABLE reporte_produccion ADD COLUMN pdf_url VARCHAR(300) NULL COMMENT 'PDF original de CIISA guardado en uploads'`, SIN_REPORTE);
  await ignorar(`ALTER TABLE reporte_produccion ADD COLUMN importacion_id INT NULL COMMENT 'Importación (motor) que lo cargó'`, SIN_REPORTE);

  await ignorar(`ALTER TABLE reporte_produccion_lineas ADD COLUMN codigo_informado VARCHAR(20) NOT NULL DEFAULT '' COMMENT 'Código que traía la planta si la línea quedó en 99 (pendiente de codificar)'`, SIN_REPORTE);
  // Nueva llave primero, después se suelta la vieja (así nunca queda la tabla sin llave única).
  await ignorar(`CREATE UNIQUE INDEX uk_rpl_articulo_inf ON reporte_produccion_lineas (reporte_id, articulo_codigo, codigo_informado)`, SIN_REPORTE);
  await ignorar(`ALTER TABLE reporte_produccion_lineas DROP INDEX uk_rpl_articulo`, null, ['ER_CANT_DROP_FIELD_OR_KEY']);

  await ignorar(`ALTER TABLE solicitud_lineas ADD COLUMN corte_informado VARCHAR(120) NOT NULL DEFAULT '' COMMENT 'Nombre del corte si quedó en 99 (fila sin código de una solicitud histórica)'`, SIN_REPORTE);
  await ignorar(`CREATE UNIQUE INDEX uk_sl_canal_corte_inf ON solicitud_lineas (solicitud_canal_id, corte_codigo, corte_informado)`, SIN_REPORTE);
  await ignorar(`ALTER TABLE solicitud_lineas DROP INDEX uk_sl_canal_corte`, null, ['ER_CANT_DROP_FIELD_OR_KEY']);

  await ignorar(`ALTER TABLE solicitudes_deshuese MODIFY COLUMN estado ENUM('borrador','enviada','deshuesada','con_reporte') NOT NULL DEFAULT 'borrador'`, SIN_REPORTE);
  await ignorar(`ALTER TABLE solicitudes_deshuese ADD COLUMN importacion_id INT NULL COMMENT 'Importación de una solicitud histórica (Excel de la planta)'`);
}

module.exports = { migrarProduccionCatalogo, TIPOS_CORTE };
