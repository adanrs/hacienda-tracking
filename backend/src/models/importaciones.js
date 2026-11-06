// Migración aditiva e idempotente del importador masivo y de la guía de transporte.
//
// Se llama al final de initDB (database.js). Todo es CREATE TABLE IF NOT EXISTS o ALTER ... ADD
// COLUMN al FINAL de la tabla: las columnas existentes no cambian y re-arrancar no duplica nada
// (solo se tolera «ya existe»; cualquier otro error queda en el log con su consecuencia).
//
// Qué agrega:
//   animales     → identificacion_electronica (I.E., chip; única), madre_numero / padre_numero
//                  (el número tal como lo trae Ganadero SG, aunque la madre no esté en la app),
//                  finca (código y nombre de la finca de origen).
//   transporte   → guia_id: cada animal de una guía sigue teniendo su fila de transporte (la
//                  pantalla Transporte y la línea de tiempo del animal la siguen mostrando).
//   sacrificios  → guia_id, grasa (puntaje CIISA), rendimiento_informado (el que manda la planta,
//                  para comparar con el calculado), importacion_id.
//   guias_transporte (+ _animales) → la guía del día: finca → planta, con la ficha del animal
//                  congelada al momento de la salida (lo que dijo Ganadero SG ese día).
//   importaciones (+ _bitacora)    → quién importó qué archivo, cuándo, y qué tocó cada fila.

async function migrarImportaciones(conn) {
  const ignorarSiExiste = async (sql, consecuencia) => {
    try { await conn.query(sql); } catch (e) {
      if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(e.code)) return;
      console.error(`[initDB importaciones] ${e.code || 'ERROR'}: ${e.message}${consecuencia ? ` — ${consecuencia}` : ''}`);
    }
  };
  const SIN_IMPORTADOR = 'el importador de Ganadero SG / sacrificio NO va a funcionar hasta corregirlo';

  await ignorarSiExiste(`ALTER TABLE animales ADD COLUMN identificacion_electronica VARCHAR(32) NULL COMMENT 'I.E.: identificación electrónica (chip) de Ganadero SG'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`CREATE UNIQUE INDEX uk_animal_ie ON animales (identificacion_electronica)`, 'la I.E. no quedará única');
  await ignorarSiExiste(`ALTER TABLE animales ADD COLUMN madre_numero VARCHAR(50) NULL COMMENT 'N.º de la madre según Ganadero SG (aunque no esté registrada en la app)'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`ALTER TABLE animales ADD COLUMN padre_numero VARCHAR(50) NULL COMMENT 'N.º del padre según Ganadero SG (toro o pajilla)'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`ALTER TABLE animales ADD COLUMN finca VARCHAR(120) NULL COMMENT 'Finca de origen (p. ej. 01-003 - ENGORDE WAGYU)'`, SIN_IMPORTADOR);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS importaciones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      formato VARCHAR(40) NOT NULL COMMENT 'Clave de lib/importador/formatos.js',
      origen ENUM('archivo','pegado') NOT NULL DEFAULT 'archivo',
      archivo_nombre VARCHAR(255) NULL,
      archivo_sha256 CHAR(64) NULL COMMENT 'Huella del archivo o del texto pegado',
      huella_plan CHAR(64) NOT NULL COMMENT 'Huella de la vista previa que el usuario aprobó',
      resumen JSON NULL,
      metadatos JSON NULL,
      usuario_id INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_imp_formato (formato, created_at),
      INDEX idx_imp_archivo (archivo_sha256),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    ) COMMENT='Registro de cada importación masiva aplicada'
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS importaciones_bitacora (
      id INT AUTO_INCREMENT PRIMARY KEY,
      importacion_id INT NOT NULL,
      fila INT NULL COMMENT 'Fila del archivo (como la ve el usuario en Excel)',
      entidad VARCHAR(40) NOT NULL COMMENT 'animal, pesaje, vacuna, potrero, guia, transporte, sacrificio',
      entidad_id INT NULL,
      accion VARCHAR(20) NOT NULL COMMENT 'creado, actualizado, sin_cambios, omitido',
      detalle JSON NULL COMMENT 'Cambios (antes → después), errores o avisos',
      INDEX idx_ib_importacion (importacion_id),
      INDEX idx_ib_entidad (entidad, entidad_id),
      FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE CASCADE
    ) COMMENT='Qué hizo cada importación, fila por fila'
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS guias_transporte (
      id INT AUTO_INCREMENT PRIMARY KEY,
      numero VARCHAR(20) NOT NULL COMMENT 'GT-AAAAMMDD-NNN (consecutivo de la app)',
      fecha_salida DATE NOT NULL,
      finca_origen VARCHAR(120) NOT NULL DEFAULT '' COMMENT 'Finca de origen (Ganadero SG)',
      destino VARCHAR(200) NULL COMMENT 'Planta de sacrificio (config_planta)',
      comprador VARCHAR(200) NOT NULL DEFAULT '' COMMENT '«Vendido a» de Ganadero SG',
      tipo_destino VARCHAR(20) NULL COMMENT 'Tipo Dest de Ganadero SG (V = venta)',
      causa_salida VARCHAR(100) NULL,
      total_animales INT NOT NULL DEFAULT 0,
      peso_total_kg DECIMAL(10,2) NULL,
      estado ENUM('borrador','despachada','recibida','anulada') NOT NULL DEFAULT 'borrador',
      transportista VARCHAR(200) NULL,
      placa_vehiculo VARCHAR(20) NULL,
      guia_movilizacion VARCHAR(100) NULL COMMENT 'N.º de guía oficial (SENASA), si aplica',
      notas TEXT NULL,
      importacion_id INT NULL,
      creado_por INT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gt_numero (numero),
      UNIQUE KEY uk_gt_dia (fecha_salida, finca_origen, comprador),
      FOREIGN KEY (importacion_id) REFERENCES importaciones(id) ON DELETE SET NULL,
      FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
    ) COMMENT='Guía de transporte: animales que salen de la finca a la planta en un día'
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS guia_transporte_animales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guia_id INT NOT NULL,
      animal_id INT NOT NULL,
      transporte_id INT NULL,
      orden SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      arete VARCHAR(50) NOT NULL COMMENT 'Número del animal al momento de la salida',
      identificacion_electronica VARCHAR(32) NULL,
      sexo ENUM('macho','hembra') NULL,
      raza VARCHAR(100) NULL,
      fecha_nacimiento DATE NULL,
      edad_meses DECIMAL(5,1) NULL,
      madre_numero VARCHAR(50) NULL,
      padre_numero VARCHAR(50) NULL,
      potrero VARCHAR(100) NULL,
      dias_potrero INT NULL,
      ultimo_peso_kg DECIMAL(8,2) NULL,
      gr_dia_vida DECIMAL(8,2) NULL,
      fecha_ultima_vacuna DATE NULL,
      ultima_vacuna VARCHAR(100) NULL,
      causa_salida VARCHAR(100) NULL,
      tipo_destino VARCHAR(20) NULL,
      obs_salida VARCHAR(200) NULL,
      peso_salida_kg DECIMAL(8,2) NULL,
      fila_origen INT NULL COMMENT 'Fila del archivo importado',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gta_guia_animal (guia_id, animal_id),
      INDEX idx_gta_animal (animal_id),
      INDEX idx_gta_arete (arete),
      FOREIGN KEY (guia_id) REFERENCES guias_transporte(id) ON DELETE CASCADE,
      FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
      FOREIGN KEY (transporte_id) REFERENCES transporte(id) ON DELETE SET NULL
    ) COMMENT='Animales de la guía con su ficha al momento de salir (snapshot de Ganadero SG)'
  `);

  await ignorarSiExiste(`ALTER TABLE transporte ADD COLUMN guia_id INT NULL COMMENT 'Guía de transporte a la que pertenece'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`CREATE INDEX idx_transporte_guia ON transporte (guia_id)`);
  await ignorarSiExiste(`ALTER TABLE sacrificios ADD COLUMN guia_id INT NULL COMMENT 'Guía de transporte con la que llegó el animal'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`CREATE INDEX idx_sacrificio_guia ON sacrificios (guia_id)`);
  await ignorarSiExiste(`ALTER TABLE sacrificios ADD COLUMN grasa INT NULL COMMENT 'Puntaje de grasa que informa CIISA'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`ALTER TABLE sacrificios ADD COLUMN rendimiento_informado DECIMAL(5,2) NULL COMMENT 'Rendimiento % tal como lo informa la planta'`, SIN_IMPORTADOR);
  await ignorarSiExiste(`ALTER TABLE sacrificios ADD COLUMN importacion_id INT NULL COMMENT 'Importación que lo creó o actualizó por última vez'`);
}

module.exports = { migrarImportaciones };
