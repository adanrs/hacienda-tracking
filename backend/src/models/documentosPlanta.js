// Migración aditiva e idempotente: guías de movilización del MAG y documentos de custodia de CIISA.
//
// Se llama al final de initDB (database.js), después de migrarImportaciones (FK a importaciones y
// guias_transporte). Solo CREATE TABLE IF NOT EXISTS: re-arrancar no cambia nada.
//
//   guias_movilizacion            → la guía oficial FTZ-02 del SENASA (número, fecha, origen →
//                                   destino, transporte). Una por número.
//   guia_movilizacion_animales    → cada bovino de la guía con su DIIO. animal_id queda NULL si
//                                   ningún animal tiene esa I.E.: se corrige a mano desde la
//                                   pantalla (vinculo = 'manual'), nunca se adivina.
//   documentos_custodia           → ASE (ajuste de salida) y TRE (traslado) de la bodega de custodia
//                                   107 de CIISA, con el Lote CC y la RES de las Observaciones y el
//                                   animal cuando se puede ligar sin dudas.
//   documentos_custodia_lineas    → artículos del documento (código, cajas, kg) y su equivalente.

async function crear(conn, sql, nombre) {
  try { await conn.query(sql); } catch (e) {
    console.error(`[initDB documentos planta] ${e.code || 'ERROR'}: ${e.message} — la importación de ${nombre} NO va a funcionar hasta corregirlo`);
  }
}

async function migrarDocumentosPlanta(conn) {
  await crear(conn, `
    CREATE TABLE IF NOT EXISTS guias_movilizacion (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(20) NOT NULL COMMENT 'N.º de la guía FTZ-02 (p. ej. EH0204095)',
      fecha DATE NOT NULL,
      hora VARCHAR(5) NULL,
      autorizacion VARCHAR(30) NULL COMMENT 'Número de autorización del SENASA',
      origen_nombre VARCHAR(200) NULL,
      origen_establecimiento VARCHAR(200) NULL,
      origen_cue VARCHAR(20) NULL,
      destino_nombre VARCHAR(200) NULL,
      destino_establecimiento VARCHAR(200) NULL COMMENT 'P. ej. CIISA-EL ARREO-ESTABLECIMIENTO 12 (BOVINOS)',
      destino_cue VARCHAR(20) NULL,
      transportista VARCHAR(200) NULL,
      placa VARCHAR(40) NULL,
      conductor VARCHAR(200) NULL,
      total_declarado SMALLINT UNSIGNED NULL COMMENT 'Cantidad de bovinos que dice la guía',
      guia_transporte_id INT NULL COMMENT 'Guía de transporte de la app del mismo día y animales',
      archivo_nombre VARCHAR(255) NULL,
      importacion_id INT NULL,
      creado_por INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gm_numero (numero),
      INDEX idx_gm_fecha (fecha),
      FOREIGN KEY (guia_transporte_id) REFERENCES guias_transporte(id) ON DELETE SET NULL,
      FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE SET NULL,
      FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
    ) COMMENT='Guía de movilización del MAG/SENASA (FTZ-02)'
  `, 'guías de movilización');

  await crear(conn, `
    CREATE TABLE IF NOT EXISTS guia_movilizacion_animales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guia_id INT NOT NULL,
      orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      diio VARCHAR(20) NOT NULL COMMENT 'Dispositivo oficial (DIIO) tal como lo trae la guía',
      sexo VARCHAR(3) NULL COMMENT 'H, M o MC como lo trae la guía',
      raza VARCHAR(100) NULL,
      animal_id INT NULL COMMENT 'NULL = sin animal: ninguna I.E. calza (se corrige a mano)',
      vinculo ENUM('automatico','manual') NULL COMMENT 'automatico = por I.E.; manual = lo ligó un usuario',
      vinculado_por INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gma_guia_diio (guia_id, diio),
      INDEX idx_gma_diio (diio),
      INDEX idx_gma_animal (animal_id),
      FOREIGN KEY (guia_id) REFERENCES guias_movilizacion(id) ON DELETE CASCADE,
      FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE SET NULL,
      FOREIGN KEY (vinculado_por) REFERENCES usuarios(id) ON DELETE SET NULL
    ) COMMENT='Bovinos de la guía de movilización con su DIIO'
  `, 'guías de movilización');

  await crear(conn, `
    CREATE TABLE IF NOT EXISTS documentos_custodia (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tipo ENUM('ajuste_salida','traslado') NOT NULL COMMENT 'ASE = ajuste de salida; TRE = traslado de inventario',
      numero INT UNSIGNED NOT NULL COMMENT 'No. del documento CIISA',
      fecha DATETIME NOT NULL,
      bodega_origen_codigo VARCHAR(10) NULL,
      bodega_origen_nombre VARCHAR(100) NULL,
      bodega_destino_codigo VARCHAR(10) NULL,
      bodega_destino_nombre VARCHAR(100) NULL,
      estado VARCHAR(30) NULL,
      observaciones VARCHAR(500) NULL,
      lote_cc SMALLINT UNSIGNED NULL COMMENT 'LOTE nn de las Observaciones (lote de deshuese)',
      res VARCHAR(10) NULL COMMENT 'RES nnnn de las Observaciones (n.º de canal)',
      animal_id INT NULL COMMENT 'Animal ligado por fecha + Lote CC / RES; NULL si no se pudo sin dudas',
      vinculo ENUM('automatico','manual') NULL,
      vinculado_por INT NULL,
      total_cajas DECIMAL(10,2) NULL COMMENT 'Suma de las líneas',
      total_kg DECIMAL(12,3) NULL COMMENT 'Suma de las líneas',
      total_cajas_declarado DECIMAL(10,2) NULL COMMENT 'Total impreso en el documento',
      total_kg_declarado DECIMAL(12,3) NULL COMMENT 'Total impreso en el documento',
      archivo_nombre VARCHAR(255) NULL,
      importacion_id INT NULL,
      creado_por INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_dc_tipo_numero (tipo, numero),
      INDEX idx_dc_fecha (fecha),
      INDEX idx_dc_animal (animal_id),
      FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE SET NULL,
      FOREIGN KEY (vinculado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
      FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE SET NULL,
      FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
    ) COMMENT='Documentos de custodia de CIISA: ajuste de salida (ASE) y traslado (TRE)'
  `, 'documentos de custodia');

  await crear(conn, `
    CREATE TABLE IF NOT EXISTS documentos_custodia_lineas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      documento_id INT NOT NULL,
      orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      codigo VARCHAR(10) NOT NULL COMMENT 'Artículo CIISA',
      codigo_equivalente VARCHAR(10) NULL COMMENT 'Código equivalente conocido (25000 ↔ 22229, 25002 ↔ 11163)',
      descripcion VARCHAR(150) NULL,
      unidad VARCHAR(10) NULL COMMENT 'Und.Alm. (CAJ)',
      cajas DECIMAL(10,2) NULL,
      kg DECIMAL(10,3) NULL,
      INDEX idx_dcl_documento (documento_id),
      INDEX idx_dcl_codigo (codigo),
      FOREIGN KEY (documento_id) REFERENCES documentos_custodia(id) ON DELETE CASCADE
    ) COMMENT='Artículos de cada documento de custodia'
  `, 'documentos de custodia');
}

module.exports = { migrarDocumentosPlanta };
