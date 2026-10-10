-- =============================================================================
-- Núcleo de inventario v10 — PROPUESTA PARA REVISIÓN (no conectada a database.js)
-- Cliente: Wagyu Cross / EQTBL · Planta: CIISA «El Arreo»
-- Base: «Sistema de Trazabilidad v10» (8-oct-2026). Ver DISEÑO.md en esta carpeta.
--
-- MySQL 8.0.29+ (CREATE TRIGGER IF NOT EXISTS no se usa; se hace DROP + CREATE).
-- Idempotente: se puede correr N veces. Ejecutar con el cliente `mysql`
-- (usa DELIMITER para procedimientos y triggers).
--
-- Convenciones:
--   * FKs hacia tablas existentes usan INT (los PK actuales son INT con signo).
--   * Tablas de bitácora de alto volumen usan BIGINT.
--   * Nunca hay FK sobre VARCHAR hacia tablas existentes (evita choques de collation).
--   * Pesos en kg con DECIMAL(10,3); porcentajes con DECIMAL(6,3).
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 0. Ayudantes idempotentes para ALTER sobre tablas existentes
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS v10_add_column;
DROP PROCEDURE IF EXISTS v10_add_index;
DROP PROCEDURE IF EXISTS v10_add_fk;
DROP PROCEDURE IF EXISTS v10_modify_column;

DELIMITER $$
CREATE PROCEDURE v10_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_def TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @v10_sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_def);
    PREPARE st FROM @v10_sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$

CREATE PROCEDURE v10_modify_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_def TEXT)
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column) THEN
    SET @v10_sql = CONCAT('ALTER TABLE `', p_table, '` MODIFY COLUMN `', p_column, '` ', p_def);
    PREPARE st FROM @v10_sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$

CREATE PROCEDURE v10_add_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_cols TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index) THEN
    SET @v10_sql = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` (', p_cols, ')');
    PREPARE st FROM @v10_sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$

CREATE PROCEDURE v10_add_fk(IN p_table VARCHAR(64), IN p_fk VARCHAR(64), IN p_def TEXT)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table
                   AND CONSTRAINT_NAME = p_fk AND CONSTRAINT_TYPE = 'FOREIGN KEY') THEN
    SET @v10_sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_fk, '` ', p_def);
    PREPARE st FROM @v10_sql; EXECUTE st; DEALLOCATE PREPARE st;
  END IF;
END$$
DELIMITER ;

-- -----------------------------------------------------------------------------
-- 1. Tablas existentes que se EXTIENDEN (no se recrean)
-- -----------------------------------------------------------------------------

-- 1.1 usuarios: empresa + PIN (§3, §9). `rol` (admin/operador/viewer) queda como
--     acceso grueso a la app; los permisos por etapa van en usuario_roles.
CALL v10_add_column('usuarios', 'empresa',
  "ENUM('CIISA','WAGYU_CROSS') NULL COMMENT 'Empresa a la que pertenece el usuario (§9). NULL = pendiente de clasificar en la migración' AFTER rol");
CALL v10_add_column('usuarios', 'pin_hash',
  "VARCHAR(100) NULL COMMENT 'bcrypt del PIN de 4 dígitos. Lo define el administrador; el usuario no lo cambia (§3)' AFTER empresa");
CALL v10_add_column('usuarios', 'pin_definido_por',
  "INT NULL COMMENT 'Administrador que definió/reseteó el PIN por última vez' AFTER pin_hash");
CALL v10_add_column('usuarios', 'pin_definido_at',
  "DATETIME NULL COMMENT 'Fecha/hora del último set/reset de PIN' AFTER pin_definido_por");
CALL v10_add_column('usuarios', 'pin_intentos_fallidos',
  "TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Intentos fallidos consecutivos; se reinicia al acertar' AFTER pin_definido_at");
CALL v10_add_column('usuarios', 'pin_bloqueado_hasta',
  "DATETIME NULL COMMENT 'Bloqueo temporal tras N intentos fallidos (anti fuerza bruta: 10.000 combinaciones)' AFTER pin_intentos_fallidos");

-- 1.2 bodegas: se agregan las dimensiones del doc v10. La columna `tipo` actual
--     (salas: deshuese/custodia/...) se conserva porque el frontend filtra por ella
--     (Custodia.jsx, Maduracion.jsx); se vuelve NULL-able y en el corte pasa a `sala`.
CALL v10_modify_column('bodegas', 'tipo',
  "ENUM('deshuese','custodia','maduracion','porcionado','despacho') NULL COMMENT 'LEGACY: sala física. Se renombra a sala en el corte'");
CALL v10_add_column('bodegas', 'naturaleza',
  "ENUM('fisica','virtual') NULL COMMENT 'Tipo física/virtual del doc v10. 107 es virtual (custodia dentro del sistema de CIISA)' AFTER tipo");
CALL v10_add_column('bodegas', 'ambito_inventario',
  "ENUM('proceso','custodia','propio') NULL COMMENT 'proceso = salas CIISA (deshuese, maduración, paquetería); custodia = 107; propio = WC-01' AFTER naturaleza");
CALL v10_add_column('bodegas', 'empresa_custodio',
  "ENUM('CIISA','WAGYU_CROSS') NULL COMMENT 'Quién tiene físicamente el producto' AFTER ambito_inventario");
CALL v10_add_column('bodegas', 'empresa_propietaria',
  "ENUM('CIISA','WAGYU_CROSS') NOT NULL DEFAULT 'WAGYU_CROSS' COMMENT 'Dueño del inventario (el ganado es de WC aunque esté en CIISA)' AFTER empresa_custodio");
CALL v10_add_column('bodegas', 'codigo_ciisa',
  "VARCHAR(10) NULL COMMENT 'Número de bodega en el sistema de CIISA (12, 107). Se usa para casar TRE/ASE/INV' AFTER empresa_propietaria");
CALL v10_add_column('bodegas', 'cuenta_inventario_wc',
  "VARCHAR(30) NULL COMMENT 'Cuenta/bodega de inventario en Enlace (contabilidad EQTBL) para la exportación' AFTER codigo_ciisa");
CALL v10_add_column('bodegas', 'es_legacy',
  "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = bodega del modelo anterior (BOD-*), solo lectura tras el corte' AFTER cuenta_inventario_wc");

-- 1.3 catalogo_cortes funciona como catalogo_articulos (§13.4): se agregan datos
--     de Enlace y del e-commerce.
CALL v10_add_column('catalogo_cortes', 'nombre_en',
  "VARCHAR(200) NULL COMMENT 'Nombre en inglés para el e-commerce (§12)' AFTER nombre");
CALL v10_add_column('catalogo_cortes', 'sku_web',
  "VARCHAR(50) NULL COMMENT 'SKU de la tienda web' AFTER nombre_en");
CALL v10_add_column('catalogo_cortes', 'codigo_enlace',
  "VARCHAR(30) NULL COMMENT 'Código de artículo en Enlace si difiere del código CIISA de 5 dígitos' AFTER sku_web");
CALL v10_add_column('catalogo_cortes', 'unidad_enlace',
  "ENUM('kg','unidad') NOT NULL DEFAULT 'kg' COMMENT 'Enlace no acepta decimales en Unid para artículos por unidad (§12)' AFTER codigo_enlace");

-- 1.4 porcionado: enlace al primal como etiqueta (para recorte declarado y balance).
CALL v10_add_column('porcionado', 'etiqueta_primal_id',
  "INT NULL COMMENT 'Etiqueta del primal porcionado (núcleo v10). primal_id queda por compatibilidad' AFTER primal_id");
CALL v10_add_index('porcionado', 'idx_porc_etiqueta_primal', 'etiqueta_primal_id');

-- -----------------------------------------------------------------------------
-- 2. Seguridad: roles por etapa, autorizaciones con PIN, consecutivos
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles_etapa (
  codigo      VARCHAR(40) NOT NULL COMMENT 'Código estable del rol, p. ej. CIISA_PAQUETERIA',
  empresa     ENUM('CIISA','WAGYU_CROSS') NOT NULL COMMENT 'Roles separados por empresa (§9)',
  nombre      VARCHAR(120) NOT NULL COMMENT 'Nombre visible',
  etapas      SET('recepcion_planta','sacrificio','calidad','deshuese','custodia_107','maduracion',
                  'paqueteria','despacho_arreo','recepcion_wc01','inventario_wc01','conciliacion',
                  'parametros','administracion') NOT NULL COMMENT 'Etapas que el rol ve y opera (cada usuario de Arreo ve solo las suyas)',
  puede_aceptar_dat TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = puede aceptar/rechazar DAT (supervisor WC)',
  activo      TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Rol vigente',
  PRIMARY KEY (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Catálogo de roles por empresa y etapa (§9)';

CREATE TABLE IF NOT EXISTS usuario_roles (
  usuario_id  INT NOT NULL COMMENT 'FK usuarios.id',
  rol_codigo  VARCHAR(40) NOT NULL COMMENT 'FK roles_etapa.codigo',
  asignado_por INT NULL COMMENT 'Administrador que asignó el rol',
  asignado_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de asignación',
  PRIMARY KEY (usuario_id, rol_codigo),
  CONSTRAINT fk_ur_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_rol FOREIGN KEY (rol_codigo) REFERENCES roles_etapa(codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Un usuario puede tener varios roles de SU empresa';

CREATE TABLE IF NOT EXISTS log_autorizaciones (
  id             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  usuario_id     INT NOT NULL COMMENT 'Quién digitó el PIN',
  accion         VARCHAR(60) NOT NULL COMMENT 'firmar_dat, aceptar_dat, rechazar_dat, resolver_diferencia, reempaque, descarte, editar_banda, aceptar_propuesta_banda, ajuste_toma_fisica, captura_manual, set_pin...',
  objeto_tipo    VARCHAR(40) NOT NULL COMMENT 'Tabla/entidad afectada (dat, etiquetas, parametros_bandas...)',
  objeto_id      BIGINT NULL COMMENT 'Id del objeto afectado',
  valor_anterior JSON NULL COMMENT 'Estado previo relevante',
  valor_nuevo    JSON NULL COMMENT 'Estado nuevo relevante',
  resultado      ENUM('ok','pin_invalido','pin_bloqueado','sin_permiso') NOT NULL COMMENT 'También se registran intentos fallidos',
  motivo         VARCHAR(500) NULL COMMENT 'Justificación digitada por el usuario',
  ip             VARCHAR(45) NULL COMMENT 'IP del cliente',
  dispositivo    VARCHAR(200) NULL COMMENT 'User-agent / id de escáner',
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Fecha/hora con milisegundos',
  PRIMARY KEY (id),
  KEY idx_la_usuario (usuario_id, created_at),
  KEY idx_la_objeto (objeto_tipo, objeto_id),
  CONSTRAINT fk_la_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Bitácora inmutable de toda acción firmada con PIN (§3)';

CREATE TABLE IF NOT EXISTS consecutivos (
  serie   VARCHAR(10) NOT NULL COMMENT 'DAT, OT (orden traslado), OD (orden despacho), DES (descarte)...',
  anio    SMALLINT NOT NULL COMMENT 'Año del consecutivo (se reinicia cada año)',
  ultimo  INT NOT NULL DEFAULT 0 COMMENT 'Último número emitido; se toma con SELECT ... FOR UPDATE',
  PRIMARY KEY (serie, anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Consecutivos sin huecos, p. ej. DAT-AAAA-NNNN';

-- -----------------------------------------------------------------------------
-- 3. Cadena de identificadores: canal y lote de deshuese (§4)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS canales (
  id             INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  fecha_matanza  DATE NOT NULL COMMENT 'Día de matanza',
  numero_canal   SMALLINT UNSIGNED NOT NULL COMMENT 'Consecutivo CIISA del día de matanza',
  sacrificio_id  INT NOT NULL COMMENT 'FK sacrificios.id (tabla existente)',
  animal_id      INT NOT NULL COMMENT 'FK animales.id',
  arete          VARCHAR(7) NOT NULL COMMENT 'Copia del arete (llave maestra, 6 alfanum. + guion opcional) para búsquedas por escaneo',
  peso_canal_caliente DECIMAL(10,3) NULL COMMENT 'kg canal caliente según CIISA',
  peso_canal_frio     DECIMAL(10,3) NULL COMMENT 'kg canal fría',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_canal_dia (fecha_matanza, numero_canal),
  UNIQUE KEY uk_canal_sacrificio (sacrificio_id),
  KEY idx_canal_arete (arete),
  CONSTRAINT fk_canal_sacrificio FOREIGN KEY (sacrificio_id) REFERENCES sacrificios(id),
  CONSTRAINT fk_canal_animal FOREIGN KEY (animal_id) REFERENCES animales(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='N.º de canal CIISA: el número se repite cada día, la llave es fecha + número';

CREATE TABLE IF NOT EXISTS lotes_deshuese (
  id              INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  fecha_deshuese  DATE NOT NULL COMMENT 'Fecha del deshuese (el lote CC se reinicia por deshuese)',
  numero_lote     SMALLINT UNSIGNED NOT NULL COMMENT 'Número de lote CC impreso en etiquetas (2 díg. en paquete/primal, 4 en caja)',
  canal_id        INT NOT NULL COMMENT 'FK canales.id — un lote por canal',
  animal_id       INT NOT NULL COMMENT 'FK animales.id — un lote = un arete',
  arete           VARCHAR(7) NOT NULL COMMENT 'Arete resuelto (denormalizado para resolver cajas por fecha+lote)',
  deshuese_id     INT NULL COMMENT 'FK deshuese.id (registro operativo existente, PDF, primales)',
  cruce           ENUM('F1','FB','F2','F3') NULL COMMENT 'Cruce del animal; define banda y tarifa BU',
  sexo            ENUM('M','H') NULL COMMENT 'Sexo para bandas de rendimiento',
  kg_entrada      DECIMAL(10,3) NULL COMMENT 'kg canal que entra a deshuese',
  kg_deshuesado   DECIMAL(10,3) NULL COMMENT 'kg de producto que sale (suma de etiquetas de deshuese al cerrar)',
  estado          ENUM('abierto','cerrado') NOT NULL DEFAULT 'abierto' COMMENT 'Al cerrar se calcula rendimiento y se propone banda μ±2σ',
  cerrado_at      DATETIME NULL COMMENT 'Cierre del lote',
  PRIMARY KEY (id),
  UNIQUE KEY uk_lote_fecha_num (fecha_deshuese, numero_lote),
  UNIQUE KEY uk_lote_canal (canal_id),
  KEY idx_lote_arete (arete),
  CONSTRAINT fk_ld_canal FOREIGN KEY (canal_id) REFERENCES canales(id),
  CONSTRAINT fk_ld_animal FOREIGN KEY (animal_id) REFERENCES animales(id),
  CONSTRAINT fk_ld_deshuese FOREIGN KEY (deshuese_id) REFERENCES deshuese(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Lote CC de deshuese: llave única fecha + número; resuelve arete de las cajas';

-- -----------------------------------------------------------------------------
-- 4. Captura de documentos CIISA (§2.2, §11)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cargas_ciisa (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  tipo_documento   ENUM('TRE','ASE','INV_SEMANAL','DESHUESE','PORCIONADO','OTRO') NOT NULL COMMENT 'Plantilla aplicada',
  metodo           ENUM('excel_csv','pdf_ia','imagen_ia','manual') NOT NULL COMMENT 'Escala de captura §11 (escaneo no pasa por aquí)',
  archivo_nombre   VARCHAR(255) NULL COMMENT 'Nombre original del archivo',
  archivo_ruta     VARCHAR(500) NULL COMMENT 'Ruta en uploads/',
  archivo_sha256   CHAR(64) NULL COMMENT 'Hash para impedir cargar dos veces el mismo archivo',
  plantilla_version VARCHAR(20) NULL COMMENT 'Versión de la plantilla de columnas usada',
  estado           ENUM('procesando','pendiente_confirmacion','cargada','con_diferencias','error') NOT NULL DEFAULT 'procesando' COMMENT 'pendiente_confirmacion = extraído por IA, falta revisión humana',
  filas_leidas     INT NULL COMMENT 'Filas leídas del archivo',
  filas_validas    INT NULL COMMENT 'Filas que pasaron validación',
  resultado        JSON NULL COMMENT 'Resumen de conciliación y errores por fila',
  cargado_por      INT NOT NULL COMMENT 'FK usuarios.id',
  confirmado_por   INT NULL COMMENT 'Quién confirmó la extracción por IA',
  autorizacion_id  BIGINT NULL COMMENT 'FK log_autorizaciones (obligatorio si metodo = manual)',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_carga_sha (archivo_sha256),
  CONSTRAINT fk_cc_usuario FOREIGN KEY (cargado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_cc_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Cada archivo Excel/CSV/PDF/imagen de CIISA cargado';

CREATE TABLE IF NOT EXISTS documentos_ciisa (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  tipo             ENUM('TRE','ASE','INV_SEMANAL','DESHUESE','PORCIONADO','OTRO') NOT NULL COMMENT 'TRE 12→107, ASE salida de 107, INV WAGYU SEMANA xx',
  numero_ciisa     VARCHAR(30) NOT NULL COMMENT 'Número del documento en CIISA',
  fecha_documento  DATE NOT NULL COMMENT 'Fecha del documento CIISA',
  estado_ciisa     VARCHAR(30) NULL COMMENT 'Estado en CIISA; para TRE solo se acepta Aprobado',
  bodega_origen_id INT NULL COMMENT 'FK bodegas (12 para TRE, 107 para ASE)',
  bodega_destino_id INT NULL COMMENT 'FK bodegas (107 para TRE, WC-01 o NULL=cliente para ASE)',
  cliente_destino  VARCHAR(200) NULL COMMENT 'ASE directo a cliente B2B',
  orden_ref        VARCHAR(30) NULL COMMENT '«Orden #» leído de Observaciones del ASE (OT/OD de WC)',
  semana           TINYINT UNSIGNED NULL COMMENT 'Semana del corte INV WAGYU SEMANA xx',
  observaciones    TEXT NULL COMMENT 'Texto crudo de observaciones',
  carga_id         INT NULL COMMENT 'FK cargas_ciisa — de qué archivo salió',
  extraido_por_ia  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Marca obligatoria si lo leyó IA (§11)',
  estado_conciliacion ENUM('pendiente','cuadrado','con_diferencias','resuelto') NOT NULL DEFAULT 'pendiente' COMMENT 'Resultado contra DAT/órdenes/existencias',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_doc_tipo_num (tipo, numero_ciisa),
  KEY idx_doc_fecha (tipo, fecha_documento),
  KEY idx_doc_orden (orden_ref),
  CONSTRAINT fk_dc_bo FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id),
  CONSTRAINT fk_dc_bd FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id),
  CONSTRAINT fk_dc_carga FOREIGN KEY (carga_id) REFERENCES cargas_ciisa(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Documentos emitidos por CIISA; nunca mueven inventario, solo se concilian';

CREATE TABLE IF NOT EXISTS documentos_ciisa_lineas (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  documento_id     INT NOT NULL COMMENT 'FK documentos_ciisa',
  linea            SMALLINT UNSIGNED NOT NULL COMMENT 'Número de línea en el documento',
  articulo_codigo  VARCHAR(20) NOT NULL COMMENT 'Código de artículo CIISA (5 díg.)',
  articulo_id      INT NULL COMMENT 'FK catalogo_cortes.id resuelto',
  descripcion      VARCHAR(200) NULL COMMENT 'Descripción tal cual viene',
  unidades         DECIMAL(10,2) NULL COMMENT 'Unidades declaradas',
  kg               DECIMAL(10,3) NULL COMMENT 'kg declarados',
  lote             VARCHAR(10) NULL COMMENT 'Lote si el documento lo trae',
  arete            VARCHAR(7) NULL COMMENT 'Arete si el documento lo trae',
  PRIMARY KEY (id),
  UNIQUE KEY uk_dcl (documento_id, linea),
  KEY idx_dcl_art (articulo_codigo),
  CONSTRAINT fk_dcl_doc FOREIGN KEY (documento_id) REFERENCES documentos_ciisa(id) ON DELETE CASCADE,
  CONSTRAINT fk_dcl_art FOREIGN KEY (articulo_id) REFERENCES catalogo_cortes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Líneas artículo/unidades/kg de cada documento CIISA';

-- -----------------------------------------------------------------------------
-- 5. Etiquetas: la unidad de inventario a cualquier nivel
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS formatos_etiqueta (
  id           INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  tipo         ENUM('paquete','caja','primal') NOT NULL COMMENT 'Nivel de la etiqueta',
  version      VARCHAR(10) NOT NULL COMMENT 'Versión del formato (cambia si CIISA cambia la etiqueta)',
  longitud     TINYINT UNSIGNED NOT NULL COMMENT '28 paquete, 25 caja, 25 primal',
  simbologia   VARCHAR(20) NULL COMMENT 'Code 128 / Code 39 / GS1-128 (por confirmar con CIISA)',
  regex        VARCHAR(300) NOT NULL COMMENT 'Regex (sintaxis JS, grupos con nombre) que aplica el parser del backend',
  descripcion  VARCHAR(300) NULL COMMENT 'Layout legible',
  activo       TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Formato vigente',
  PRIMARY KEY (id),
  UNIQUE KEY uk_fe (tipo, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Layouts de las etiquetas CIISA; configurables sin deploy mientras se confirman';

CREATE TABLE IF NOT EXISTS etiquetas (
  id                 INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  codigo_crudo       VARCHAR(64) NOT NULL COMMENT 'Lectura exacta del escáner: es la llave (§ etiquetas CIISA)',
  tipo               ENUM('paquete','caja','primal','interna_previa') NOT NULL COMMENT 'interna_previa = sticker del modelo anterior, inactivo',
  formato_id         INT NULL COMMENT 'FK formatos_etiqueta usado para decodificar',
  -- campos decodificados
  arete              VARCHAR(7) NULL COMMENT 'Arete: viene en el paquete; en caja/primal se resuelve por fecha+lote',
  arete_confirmado   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = confirmado al escanear paquetes (cajas) o leído directo (paquetes)',
  animal_id          INT NULL COMMENT 'FK animales.id resuelto desde el arete',
  articulo_codigo    VARCHAR(20) NOT NULL COMMENT 'Código artículo CIISA (5 díg.) / código Arreo en primal',
  articulo_id        INT NULL COMMENT 'FK catalogo_cortes.id',
  fecha_etiqueta     DATE NULL COMMENT 'Fecha impresa (DDMMAA paquete/caja, MMDDAA primal)',
  lote_etiqueta      VARCHAR(4) NULL COMMENT 'Lote tal cual impreso (2 o 4 dígitos)',
  lote_deshuese_id   INT NULL COMMENT 'FK lotes_deshuese resuelto por fecha + número',
  kg                 DECIMAL(10,3) NOT NULL COMMENT 'Peso decodificado (gramos/100 o centésimas → kg)',
  cruce              ENUM('F1','FB','F2','F3') NULL COMMENT 'F1/FB en paquete; resto desde el animal',
  marmoleo           TINYINT UNSIGNED NULL COMMENT 'BMS 2 díg. del paquete',
  box_codigo         VARCHAR(10) NULL COMMENT 'Campo box del primal',
  campo_xxx          VARCHAR(10) NULL COMMENT 'Campo XXX de la caja (significado por confirmar)',
  sufijo             VARCHAR(10) NULL COMMENT 'Sufijo de caja/primal (significado por confirmar)',
  decodificado       JSON NULL COMMENT 'Resultado completo del parser, para auditoría',
  -- jerarquía y origen
  caja_padre_id      INT NULL COMMENT 'Caja que contiene este paquete (FK etiquetas)',
  primal_origen_id   INT NULL COMMENT 'Primal del que salió por porcionado (FK etiquetas)',
  origen_reempaque_id INT NULL COMMENT 'Etiqueta original si esta es un reempaque (misma pieza, nueva bolsa)',
  origen_etapa       ENUM('deshuese','porcionado','paqueteria','reempaque','migracion') NOT NULL COMMENT 'Dónde nació la etiqueta; deshuese define los kg deshuesados del balance',
  primal_legacy_id   INT NULL COMMENT 'FK primales.id del modelo anterior',
  -- estado de inventario
  bodega_actual_id   INT NULL COMMENT 'FK bodegas; solo la cambia un movimiento_etiqueta',
  estado             ENUM('disponible','apartada','vendida','devuelta','descartada','bloqueada','transformada') NOT NULL DEFAULT 'disponible' COMMENT 'transformada = primal porcionado o caja desagregada en paquetes (sale del conteo)',
  motivo_salida      ENUM('pedido','mercadeo','descarte','ajuste') NULL COMMENT 'Lista cerrada de salidas de WC-01. vendida+pedido|mercadeo; descartada+descarte|ajuste (faltante de toma física). NULL mientras está en inventario',
  dat_pendiente_id   INT NULL COMMENT 'DAT entregado aún no aceptado que la incluye (candado: no puede ir en otro DAT)',
  fecha_congelacion  DATETIME NULL COMMENT 'Inicio de congelación; traslado a WC-01 exige ≥ 3 días',
  fecha_vencimiento  DATE NULL COMMENT 'Calculada con vida útil del artículo; se exporta al e-commerce',
  activo             TINYINT(1) NOT NULL DEFAULT 1 COMMENT '0 = no participa en inventario (interna_previa, anulada)',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Primer escaneo/alta',
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Último cambio',
  PRIMARY KEY (id),
  UNIQUE KEY uk_etq_codigo (codigo_crudo),
  KEY idx_etq_bodega_estado (bodega_actual_id, estado),
  KEY idx_etq_arete (arete),
  KEY idx_etq_lote (lote_deshuese_id),
  KEY idx_etq_caja (caja_padre_id),
  KEY idx_etq_articulo (articulo_codigo),
  KEY idx_etq_dat (dat_pendiente_id),
  CONSTRAINT fk_etq_formato FOREIGN KEY (formato_id) REFERENCES formatos_etiqueta(id),
  CONSTRAINT fk_etq_animal FOREIGN KEY (animal_id) REFERENCES animales(id),
  CONSTRAINT fk_etq_articulo FOREIGN KEY (articulo_id) REFERENCES catalogo_cortes(id),
  CONSTRAINT fk_etq_lote FOREIGN KEY (lote_deshuese_id) REFERENCES lotes_deshuese(id),
  CONSTRAINT fk_etq_caja FOREIGN KEY (caja_padre_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_etq_primal FOREIGN KEY (primal_origen_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_etq_reempaque FOREIGN KEY (origen_reempaque_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_etq_primal_legacy FOREIGN KEY (primal_legacy_id) REFERENCES primales(id) ON DELETE SET NULL,
  CONSTRAINT fk_etq_bodega FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Unidad de inventario (paquete, caja, primal). Existencia = suma de etiquetas';

CALL v10_add_fk('porcionado', 'fk_porc_etiqueta_primal',
  'FOREIGN KEY (etiqueta_primal_id) REFERENCES etiquetas(id) ON DELETE SET NULL');

-- -----------------------------------------------------------------------------
-- 6. Órdenes de WC (traslado 107→WC-01 y despacho)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ordenes_traslado (
  id                INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  numero            VARCHAR(20) NOT NULL COMMENT 'Consecutivo WC OT-AAAA-NNNN; es el «Orden #» que CIISA pone en el ASE',
  fecha             DATE NOT NULL COMMENT 'Fecha solicitada',
  bodega_origen_id  INT NOT NULL COMMENT 'Siempre 107',
  bodega_destino_id INT NOT NULL COMMENT 'Siempre WC-01',
  estado            ENUM('borrador','emitida','en_transito','recibida','recibida_con_diferencias','cancelada') NOT NULL DEFAULT 'borrador' COMMENT 'Ciclo de la orden',
  creada_por        INT NOT NULL COMMENT 'FK usuarios',
  emitida_autorizacion_id BIGINT NULL COMMENT 'PIN del supervisor/admin WC al emitir',
  documento_ase_id  INT NULL COMMENT 'FK documentos_ciisa (ASE que CIISA emitió para esta orden)',
  notas             TEXT NULL COMMENT 'Notas',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ot_numero (numero),
  CONSTRAINT fk_ot_bo FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id),
  CONSTRAINT fk_ot_bd FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id),
  CONSTRAINT fk_ot_user FOREIGN KEY (creada_por) REFERENCES usuarios(id),
  CONSTRAINT fk_ot_aut FOREIGN KEY (emitida_autorizacion_id) REFERENCES log_autorizaciones(id),
  CONSTRAINT fk_ot_ase FOREIGN KEY (documento_ase_id) REFERENCES documentos_ciisa(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Orden de traslado de cajas master de 107 a WC-01';

CREATE TABLE IF NOT EXISTS ordenes_traslado_lineas (
  id              INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  orden_id        INT NOT NULL COMMENT 'FK ordenes_traslado',
  etiqueta_caja_id INT NOT NULL COMMENT 'Una línea = una caja master (etiquetas.tipo = caja)',
  kg_caja         DECIMAL(10,3) NOT NULL COMMENT 'kg de la etiqueta de la caja al emitir',
  dias_congelacion SMALLINT NULL COMMENT 'Días congelada al emitir (debe ser ≥ 3)',
  estado_linea    ENUM('pendiente','recibida','con_diferencia','no_llego') NOT NULL DEFAULT 'pendiente' COMMENT 'Resultado de la recepción',
  PRIMARY KEY (id),
  UNIQUE KEY uk_otl (orden_id, etiqueta_caja_id),
  KEY idx_otl_caja (etiqueta_caja_id),
  CONSTRAINT fk_otl_orden FOREIGN KEY (orden_id) REFERENCES ordenes_traslado(id) ON DELETE CASCADE,
  CONSTRAINT fk_otl_caja FOREIGN KEY (etiqueta_caja_id) REFERENCES etiquetas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Cajas solicitadas en la orden de traslado';

CREATE TABLE IF NOT EXISTS ordenes_despacho (
  id                INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  numero            VARCHAR(20) NOT NULL COMMENT 'Consecutivo WC OD-AAAA-NNNN',
  fecha             DATE NOT NULL COMMENT 'Fecha de despacho',
  bodega_origen_id  INT NOT NULL COMMENT 'WC-01, o 107 para B2B directo con ASE a cliente',
  tipo_destino      ENUM('pedido_web','b2b','mercadeo') NOT NULL COMMENT 'Mercadeo se trata como pedido pero se reporta aparte',
  referencia_pedido VARCHAR(60) NULL COMMENT 'N.º de pedido de la tienda web / OC del cliente',
  cliente           VARCHAR(200) NULL COMMENT 'Cliente o destinatario',
  estado            ENUM('borrador','preparando','despachada','cancelada') NOT NULL DEFAULT 'borrador' COMMENT 'Al preparar las etiquetas quedan apartadas',
  creada_por        INT NOT NULL COMMENT 'FK usuarios',
  despacho_autorizacion_id BIGINT NULL COMMENT 'PIN al despachar',
  documento_ase_id  INT NULL COMMENT 'ASE de CIISA cuando el origen es 107',
  exportacion_enlace_id INT NULL COMMENT 'Lote de exportación a Enlace en que salió',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_od_numero (numero),
  CONSTRAINT fk_od_bo FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id),
  CONSTRAINT fk_od_user FOREIGN KEY (creada_por) REFERENCES usuarios(id),
  CONSTRAINT fk_od_aut FOREIGN KEY (despacho_autorizacion_id) REFERENCES log_autorizaciones(id),
  CONSTRAINT fk_od_ase FOREIGN KEY (documento_ase_id) REFERENCES documentos_ciisa(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Orden de despacho (pedido web, B2B, mercadeo)';

CREATE TABLE IF NOT EXISTS ordenes_despacho_lineas (
  id           INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  orden_id     INT NOT NULL COMMENT 'FK ordenes_despacho',
  etiqueta_id  INT NOT NULL COMMENT 'Paquete (WC-01) o caja (B2B desde 107) escaneado',
  kg           DECIMAL(10,3) NOT NULL COMMENT 'kg de la etiqueta',
  precio_unitario DECIMAL(12,2) NULL COMMENT 'Opcional, para exportar ventas',
  PRIMARY KEY (id),
  UNIQUE KEY uk_odl (orden_id, etiqueta_id),
  KEY idx_odl_etq (etiqueta_id),
  CONSTRAINT fk_odl_orden FOREIGN KEY (orden_id) REFERENCES ordenes_despacho(id) ON DELETE CASCADE,
  CONSTRAINT fk_odl_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Etiquetas de cada despacho';

-- -----------------------------------------------------------------------------
-- 7. DAT — Documento de Aceptación de Traslado (§2.2)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dat (
  id                 INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  numero             VARCHAR(20) NOT NULL COMMENT 'DAT-AAAA-NNNN (tabla consecutivos)',
  tramo              ENUM('deshuese_107','107_maduracion','maduracion_paqueteria','paqueteria_fondo','107_wc01') NOT NULL COMMENT 'Traspaso físico que documenta',
  bodega_origen_id   INT NOT NULL COMMENT 'FK bodegas',
  bodega_destino_id  INT NOT NULL COMMENT 'FK bodegas',
  orden_traslado_id  INT NULL COMMENT 'Obligatorio para tramo 107_wc01',
  estado             ENUM('borrador','entregado','en_recepcion','aceptado','rechazado','anulado') NOT NULL DEFAULT 'borrador' COMMENT 'borrador = escaneando; entregado = firmado con PIN por CIISA',
  unidades           INT NOT NULL DEFAULT 0 COMMENT 'Total etiquetas',
  kg_total           DECIMAL(12,3) NOT NULL DEFAULT 0 COMMENT 'Σ kg de las etiquetas',
  entregado_por      INT NULL COMMENT 'Operario CIISA que firmó',
  entregado_at       DATETIME NULL COMMENT 'Firma de entrega',
  entrega_autorizacion_id BIGINT NULL COMMENT 'FK log_autorizaciones (PIN verificado)',
  aceptado_por       INT NULL COMMENT 'Supervisor WC que aceptó/rechazó',
  aceptado_at        DATETIME NULL COMMENT 'Fecha de aceptación/rechazo',
  aceptacion_modo    ENUM('remota_individual','remota_bloque','recepcion_fisica') NULL COMMENT '107→WC-01 solo admite recepcion_fisica',
  aceptacion_autorizacion_id BIGINT NULL COMMENT 'FK log_autorizaciones',
  motivo_rechazo     VARCHAR(500) NULL COMMENT 'Obligatorio si rechazado',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_dat_numero (numero),
  KEY idx_dat_estado (estado, tramo),
  KEY idx_dat_fecha (entregado_at),
  CONSTRAINT fk_dat_bo FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id),
  CONSTRAINT fk_dat_bd FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id),
  CONSTRAINT fk_dat_ot FOREIGN KEY (orden_traslado_id) REFERENCES ordenes_traslado(id),
  CONSTRAINT fk_dat_ent FOREIGN KEY (entregado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_dat_acp FOREIGN KEY (aceptado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_dat_aut1 FOREIGN KEY (entrega_autorizacion_id) REFERENCES log_autorizaciones(id),
  CONSTRAINT fk_dat_aut2 FOREIGN KEY (aceptacion_autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Dato maestro de todo traspaso físico; único generador de movimientos de traslado';

CREATE TABLE IF NOT EXISTS dat_lineas (
  id              INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  dat_id          INT NOT NULL COMMENT 'FK dat',
  etiqueta_id     INT NOT NULL COMMENT 'FK etiquetas escaneada',
  kg_declarado    DECIMAL(10,3) NOT NULL COMMENT 'kg de la etiqueta al entregar',
  kg_recibido     DECIMAL(10,3) NULL COMMENT 'Σ kg de paquetes escaneados al recibir (cajas en 107→WC-01)',
  estado_linea    ENUM('pendiente','aceptada','rechazada','faltante','con_diferencia') NOT NULL DEFAULT 'pendiente' COMMENT 'Estado por pieza',
  escaneado_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Momento del escaneo de entrega',
  PRIMARY KEY (id),
  UNIQUE KEY uk_datl (dat_id, etiqueta_id),
  KEY idx_datl_etq (etiqueta_id),
  CONSTRAINT fk_datl_dat FOREIGN KEY (dat_id) REFERENCES dat(id) ON DELETE CASCADE,
  CONSTRAINT fk_datl_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Etiquetas incluidas en el DAT';

CALL v10_add_fk('etiquetas', 'fk_etq_dat_pendiente',
  'FOREIGN KEY (dat_pendiente_id) REFERENCES dat(id) ON DELETE SET NULL');

-- -----------------------------------------------------------------------------
-- 8. Escaneos, excepciones y salidas
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS escaneos (
  id             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  contexto       ENUM('dat','recepcion_wc01','despacho','toma_fisica','consulta') NOT NULL COMMENT 'Pantalla/flujo donde se escaneó',
  contexto_id    INT NULL COMMENT 'Id del DAT / orden / toma',
  codigo_crudo   VARCHAR(64) NOT NULL COMMENT 'Lectura exacta',
  etiqueta_id    INT NULL COMMENT 'Etiqueta resuelta (NULL si desconocida)',
  caja_contexto_id INT NULL COMMENT 'Caja abierta al escanear el paquete (recepción WC-01)',
  resultado      ENUM('ok','duplicado','desconocido','formato_invalido','codigo_no_coincide','peso_no_cuadra','caja_no_solicitada','bodega_incorrecta','estado_invalido') NOT NULL COMMENT 'Validación inmediata',
  usuario_id     INT NOT NULL COMMENT 'Quién escaneó',
  dispositivo    VARCHAR(100) NULL COMMENT 'Escáner/dispositivo',
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Momento del escaneo',
  PRIMARY KEY (id),
  KEY idx_esc_ctx (contexto, contexto_id),
  KEY idx_esc_etq (etiqueta_id),
  CONSTRAINT fk_esc_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_esc_caja FOREIGN KEY (caja_contexto_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_esc_user FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Bitácora de toda lectura; un escaneo NUNCA mueve inventario por sí solo';

CREATE TABLE IF NOT EXISTS devoluciones_reempaque (
  id                  INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  etiqueta_original_id INT NOT NULL COMMENT 'Pieza dañada (queda devuelta)',
  etiqueta_nueva_id   INT NULL COMMENT 'Misma pieza con nueva bolsa/fecha (origen_reempaque_id apunta a la original)',
  motivo              ENUM('perdida_vacio','bolsa_rota','producto_danado','error_empaque','otro') NOT NULL COMMENT 'Causa',
  bodega_id           INT NOT NULL COMMENT 'Dónde se detectó',
  kg_antes            DECIMAL(10,3) NOT NULL COMMENT 'kg original',
  kg_despues          DECIMAL(10,3) NULL COMMENT 'kg tras reempaque (diferencia = merma de reempaque)',
  estado              ENUM('pendiente','reempacada','descartada') NOT NULL DEFAULT 'pendiente' COMMENT 'Si no se puede reempacar pasa a descarte',
  autorizacion_id     BIGINT NOT NULL COMMENT 'PIN supervisor (§3)',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  KEY idx_dr_orig (etiqueta_original_id),
  CONSTRAINT fk_dr_orig FOREIGN KEY (etiqueta_original_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_dr_nueva FOREIGN KEY (etiqueta_nueva_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_dr_bod FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  CONSTRAINT fk_dr_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Devolución/reempaque: conserva la trazabilidad de la pieza';

CREATE TABLE IF NOT EXISTS tarifas_bu (
  id            INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  cruce         ENUM('F1','FB','F2','F3') NOT NULL COMMENT 'F1 y FB tienen tarifa distinta (§12)',
  articulo_id   INT NULL COMMENT 'NULL = tarifa general del cruce',
  costo_kg      DECIMAL(12,4) NOT NULL COMMENT 'Costo BU por kg',
  moneda        CHAR(3) NOT NULL DEFAULT 'CRC' COMMENT 'Moneda',
  vigente_desde DATE NOT NULL COMMENT 'Inicio de vigencia',
  autorizacion_id BIGINT NULL COMMENT 'PIN admin al cambiar',
  PRIMARY KEY (id),
  UNIQUE KEY uk_tbu (cruce, articulo_id, vigente_desde),
  CONSTRAINT fk_tbu_art FOREIGN KEY (articulo_id) REFERENCES catalogo_cortes(id),
  CONSTRAINT fk_tbu_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Costo BU para entradas y descartes exportados a Enlace';

CREATE TABLE IF NOT EXISTS exportaciones_enlace (
  id            INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  tipo          ENUM('entradas','salidas') NOT NULL COMMENT 'Entradas por deshuese/porcionado; salidas por venta/descarte/mercadeo/traslado',
  periodo_desde DATE NOT NULL COMMENT 'Inicio del período',
  periodo_hasta DATE NOT NULL COMMENT 'Fin del período',
  archivo_ruta  VARCHAR(500) NULL COMMENT 'Archivo importar_documentos generado',
  lineas        INT NOT NULL DEFAULT 0 COMMENT 'Líneas exportadas',
  generado_por  INT NOT NULL COMMENT 'FK usuarios',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  CONSTRAINT fk_ee_user FOREIGN KEY (generado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Lotes de exportación a Enlace (formato importar_documentos)';

CALL v10_add_fk('ordenes_despacho', 'fk_od_export',
  'FOREIGN KEY (exportacion_enlace_id) REFERENCES exportaciones_enlace(id)');

CREATE TABLE IF NOT EXISTS descartes (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  numero           VARCHAR(20) NOT NULL COMMENT 'DES-AAAA-NNNN',
  etiqueta_id      INT NOT NULL COMMENT 'Pieza descartada',
  bodega_id        INT NOT NULL COMMENT 'Bodega de donde sale',
  kg               DECIMAL(10,3) NOT NULL COMMENT 'kg descartados',
  motivo           VARCHAR(300) NOT NULL COMMENT 'Causa',
  costo_kg         DECIMAL(12,4) NULL COMMENT 'Costo BU aplicado (tarifas_bu)',
  costo_total      DECIMAL(14,2) NULL COMMENT 'kg × costo',
  devolucion_id    INT NULL COMMENT 'Si viene de una devolución no reempacable',
  autorizacion_id  BIGINT NOT NULL COMMENT 'PIN de ADMINISTRADOR (§ Etapa 10)',
  exportacion_enlace_id INT NULL COMMENT 'Exportación a Enlace',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  UNIQUE KEY uk_des_numero (numero),
  UNIQUE KEY uk_des_etq (etiqueta_id),
  CONSTRAINT fk_des_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_des_bod FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  CONSTRAINT fk_des_dev FOREIGN KEY (devolucion_id) REFERENCES devoluciones_reempaque(id),
  CONSTRAINT fk_des_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id),
  CONSTRAINT fk_des_exp FOREIGN KEY (exportacion_enlace_id) REFERENCES exportaciones_enlace(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Descartes con costo, exportables a Enlace';

CREATE TABLE IF NOT EXISTS ajustes_inventario (
  id              INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  bodega_id       INT NOT NULL COMMENT 'Bodega de la toma física',
  etiqueta_id     INT NULL COMMENT 'Etiqueta faltante/sobrante (NULL si sobrante sin etiqueta conocida)',
  codigo_crudo    VARCHAR(64) NULL COMMENT 'Lectura del sobrante no registrado',
  tipo            ENUM('faltante','sobrante','correccion_peso') NOT NULL COMMENT 'Resultado de la toma física',
  kg              DECIMAL(10,3) NOT NULL COMMENT 'kg ajustados (positivo)',
  motivo          VARCHAR(300) NOT NULL COMMENT 'Justificación',
  autorizacion_id BIGINT NOT NULL COMMENT 'PIN admin',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  CONSTRAINT fk_aj_bod FOREIGN KEY (bodega_id) REFERENCES bodegas(id),
  CONSTRAINT fk_aj_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_aj_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Ajustes por toma física (única salida no comercial además del descarte)';

-- -----------------------------------------------------------------------------
-- 9. Movimientos de etiqueta (append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS movimientos_etiqueta (
  id                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  etiqueta_id       INT NOT NULL COMMENT 'FK etiquetas',
  tipo              ENUM('alta','dat','recepcion','apartado','liberacion','despacho','devolucion','reempaque','descarte','ajuste','transformacion','empaque_en_caja') NOT NULL COMMENT 'Qué lo originó',
  bodega_origen_id  INT NULL COMMENT 'Bodega antes',
  bodega_destino_id INT NULL COMMENT 'Bodega después (NULL = salió del inventario)',
  estado_anterior   VARCHAR(20) NULL COMMENT 'Estado antes',
  estado_nuevo      VARCHAR(20) NOT NULL COMMENT 'Estado después',
  kg                DECIMAL(10,3) NOT NULL COMMENT 'kg de la etiqueta en ese momento',
  documento_tipo    ENUM('dat','orden_traslado','orden_despacho','devolucion_reempaque','descarte','ajuste','porcionado','migracion') NOT NULL COMMENT 'Documento origen (nunca manual)',
  documento_id      INT NOT NULL COMMENT 'Id del documento origen',
  usuario_id        INT NOT NULL COMMENT 'Usuario que ejecutó',
  autorizacion_id   BIGINT NULL COMMENT 'PIN que respalda el movimiento',
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Momento',
  PRIMARY KEY (id),
  KEY idx_me_etq (etiqueta_id, created_at),
  KEY idx_me_doc (documento_tipo, documento_id),
  KEY idx_me_bodega (bodega_destino_id, created_at),
  CONSTRAINT fk_me_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_me_bo FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id),
  CONSTRAINT fk_me_bd FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id),
  CONSTRAINT fk_me_user FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_me_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Kardex por etiqueta. Solo lo escribe el backend al ejecutar un documento';

-- -----------------------------------------------------------------------------
-- 10. Conciliaciones
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conciliaciones (
  id                 INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  tipo               ENUM('dat_tre','dat_ase','caja_paquetes','inv_custodia','orden_recepcion') NOT NULL COMMENT 'Qué se compara',
  periodo_desde      DATE NULL COMMENT 'Período de DAT considerados',
  periodo_hasta      DATE NULL COMMENT 'Fin del período',
  documento_ciisa_id INT NULL COMMENT 'TRE/ASE/INV comparado',
  dat_id             INT NULL COMMENT 'DAT comparado (si es 1 a 1)',
  etiqueta_caja_id   INT NULL COMMENT 'Caja en caja_paquetes',
  orden_traslado_id  INT NULL COMMENT 'Orden en orden_recepcion',
  kg_esperado        DECIMAL(12,3) NULL COMMENT 'Lado sistema',
  kg_encontrado      DECIMAL(12,3) NULL COMMENT 'Lado documento/físico',
  unidades_esperadas INT NULL COMMENT 'Lado sistema',
  unidades_encontradas INT NULL COMMENT 'Lado documento/físico',
  tolerancia_pct     DECIMAL(6,3) NULL COMMENT 'Banda aplicada (p. ej. 2 % caja↔paquetes)',
  estado             ENUM('cuadrada','con_diferencias','resuelta') NOT NULL COMMENT 'Resultado',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  KEY idx_conc_tipo (tipo, estado),
  CONSTRAINT fk_conc_doc FOREIGN KEY (documento_ciisa_id) REFERENCES documentos_ciisa(id),
  CONSTRAINT fk_conc_dat FOREIGN KEY (dat_id) REFERENCES dat(id),
  CONSTRAINT fk_conc_caja FOREIGN KEY (etiqueta_caja_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_conc_ot FOREIGN KEY (orden_traslado_id) REFERENCES ordenes_traslado(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Comparación sistema vs documento CIISA o físico';

CREATE TABLE IF NOT EXISTS conciliacion_diferencias (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  conciliacion_id  INT NOT NULL COMMENT 'FK conciliaciones',
  tipo             ENUM('articulo','unidades','kg','faltante','sobrante','codigo_no_coincide','peso_no_cuadra','caja_no_solicitada') NOT NULL COMMENT 'Tipo de alerta',
  articulo_codigo  VARCHAR(20) NULL COMMENT 'Artículo afectado',
  etiqueta_id      INT NULL COMMENT 'Etiqueta afectada',
  valor_esperado   VARCHAR(100) NULL COMMENT 'Lo que dice el sistema',
  valor_encontrado VARCHAR(100) NULL COMMENT 'Lo que dice CIISA/el físico',
  resuelta         TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = resuelta',
  resolucion       VARCHAR(500) NULL COMMENT 'Qué se decidió',
  resuelta_por     INT NULL COMMENT 'Supervisor WC',
  autorizacion_id  BIGINT NULL COMMENT 'PIN del supervisor WC',
  resuelta_at      DATETIME NULL COMMENT 'Fecha de resolución',
  PRIMARY KEY (id),
  KEY idx_cd_conc (conciliacion_id, resuelta),
  CONSTRAINT fk_cd_conc FOREIGN KEY (conciliacion_id) REFERENCES conciliaciones(id) ON DELETE CASCADE,
  CONSTRAINT fk_cd_etq FOREIGN KEY (etiqueta_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_cd_user FOREIGN KEY (resuelta_por) REFERENCES usuarios(id),
  CONSTRAINT fk_cd_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Alertas de conciliación y su resolución con PIN';

-- -----------------------------------------------------------------------------
-- 11. Bandas de rendimiento (§7.2)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS parametros_bandas (
  id             INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  eslabon        ENUM('merma_transporte','matanza','deshuese','custodia','porcionado','fondo_traslado','venta') NOT NULL COMMENT 'Eslabón de la cadena',
  cruce          ENUM('F1','FB','F2','F3','*') NOT NULL DEFAULT '*' COMMENT '* = aplica a todos',
  sexo           ENUM('M','H','*') NOT NULL DEFAULT '*' COMMENT '* = aplica a ambos',
  minimo_pct     DECIMAL(6,3) NULL COMMENT 'Rendimiento/merma mínima %',
  maximo_pct     DECIMAL(6,3) NULL COMMENT 'Máxima %',
  tolerancia_pct DECIMAL(6,3) NULL COMMENT 'Tolerancia % (fondo/traslado ±2 %)',
  tolerancia_kg  DECIMAL(10,3) NULL COMMENT 'Tolerancia absoluta (custodia ±0.5 kg)',
  actualizado_por INT NULL COMMENT 'Último administrador que editó',
  autorizacion_id BIGINT NULL COMMENT 'PIN de la última edición',
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Última edición',
  PRIMARY KEY (id),
  UNIQUE KEY uk_banda (eslabon, cruce, sexo),
  CONSTRAINT fk_pb_user FOREIGN KEY (actualizado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_pb_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Bandas vigentes eslabón × cruce × sexo';

CREATE TABLE IF NOT EXISTS parametros_bandas_historial (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  banda_id         INT NOT NULL COMMENT 'FK parametros_bandas',
  origen           ENUM('manual','propuesta_estadistica','semilla') NOT NULL COMMENT 'Cómo cambió',
  valor_anterior   JSON NULL COMMENT '{minimo_pct, maximo_pct, tolerancia_pct, tolerancia_kg}',
  valor_nuevo      JSON NOT NULL COMMENT 'Mismo formato',
  usuario_id       INT NOT NULL COMMENT 'Quién',
  autorizacion_id  BIGINT NULL COMMENT 'PIN',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Cuándo',
  PRIMARY KEY (id),
  KEY idx_pbh_banda (banda_id, created_at),
  CONSTRAINT fk_pbh_banda FOREIGN KEY (banda_id) REFERENCES parametros_bandas(id),
  CONSTRAINT fk_pbh_user FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_pbh_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Historial: quién, cuándo, anterior, nuevo';

CREATE TABLE IF NOT EXISTS historial_estadistico (
  id               INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  banda_id         INT NOT NULL COMMENT 'Banda a la que aplica la propuesta',
  lote_deshuese_id INT NULL COMMENT 'Cierre de deshuese que disparó el cálculo',
  n_muestras       INT NOT NULL COMMENT 'Tamaño de la muestra',
  media_pct        DECIMAL(6,3) NOT NULL COMMENT 'μ',
  desviacion_pct   DECIMAL(6,3) NOT NULL COMMENT 'σ',
  propuesto_min    DECIMAL(6,3) NOT NULL COMMENT 'μ − 2σ',
  propuesto_max    DECIMAL(6,3) NOT NULL COMMENT 'μ + 2σ',
  estado           ENUM('pendiente','aceptada','rechazada','vencida') NOT NULL DEFAULT 'pendiente' COMMENT 'Solo se aplica si el admin acepta',
  decidido_por     INT NULL COMMENT 'Administrador',
  autorizacion_id  BIGINT NULL COMMENT 'PIN',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Alta',
  PRIMARY KEY (id),
  KEY idx_he_banda (banda_id, estado),
  CONSTRAINT fk_he_banda FOREIGN KEY (banda_id) REFERENCES parametros_bandas(id),
  CONSTRAINT fk_he_lote FOREIGN KEY (lote_deshuese_id) REFERENCES lotes_deshuese(id),
  CONSTRAINT fk_he_user FOREIGN KEY (decidido_por) REFERENCES usuarios(id),
  CONSTRAINT fk_he_aut FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Propuestas μ ± 2σ calculadas al cerrar cada deshuese';

-- -----------------------------------------------------------------------------
-- 12. Triggers: bitácoras inmutables
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_me_no_update;
DROP TRIGGER IF EXISTS trg_me_no_delete;
DROP TRIGGER IF EXISTS trg_la_no_update;
DROP TRIGGER IF EXISTS trg_la_no_delete;

DELIMITER $$
CREATE TRIGGER trg_me_no_update BEFORE UPDATE ON movimientos_etiqueta FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'movimientos_etiqueta es append-only: registre un movimiento inverso';
END$$
CREATE TRIGGER trg_me_no_delete BEFORE DELETE ON movimientos_etiqueta FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'movimientos_etiqueta es append-only';
END$$
CREATE TRIGGER trg_la_no_update BEFORE UPDATE ON log_autorizaciones FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'log_autorizaciones es inmutable';
END$$
CREATE TRIGGER trg_la_no_delete BEFORE DELETE ON log_autorizaciones FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'log_autorizaciones es inmutable';
END$$
DELIMITER ;

-- -----------------------------------------------------------------------------
-- 13. Vistas
-- -----------------------------------------------------------------------------

-- Etiquetas que cuentan como existencia: activas, no transformadas, no salidas,
-- y no reemplazadas por un reempaque. La existencia NUNCA es una columna.
CREATE OR REPLACE VIEW v_existencias AS
SELECT e.id AS etiqueta_id, e.codigo_crudo, e.tipo, e.articulo_codigo, e.articulo_id,
       e.arete, e.lote_deshuese_id, e.kg, e.cruce, e.marmoleo, e.estado,
       e.bodega_actual_id, b.codigo AS bodega_codigo, b.ambito_inventario,
       e.caja_padre_id, e.dat_pendiente_id, (e.dat_pendiente_id IS NOT NULL) AS en_transito,
       e.fecha_etiqueta, e.fecha_congelacion, e.fecha_vencimiento
FROM etiquetas e
JOIN bodegas b ON b.id = e.bodega_actual_id
WHERE e.activo = 1
  AND e.tipo <> 'interna_previa'
  AND e.estado IN ('disponible','apartada','bloqueada');

-- Inventario de custodia: bodega 107 (virtual, custodio CIISA, dueño WC).
CREATE OR REPLACE VIEW inventario_custodia AS
SELECT v.*
FROM v_existencias v
WHERE v.bodega_codigo = '107';

-- Inventario propio: WC-01 (= stock de la tienda web).
CREATE OR REPLACE VIEW inventario_wc01 AS
SELECT v.*, c.nombre AS nombre_es, c.nombre_en, c.sku_web
FROM v_existencias v
LEFT JOIN catalogo_cortes c ON c.id = v.articulo_id
WHERE v.bodega_codigo = 'WC-01';

-- Resumen por bodega/artículo para tableros y conciliación con INV WAGYU SEMANA xx.
CREATE OR REPLACE VIEW v_existencias_resumen AS
SELECT bodega_codigo, articulo_codigo, tipo,
       COUNT(*) AS unidades, SUM(kg) AS kg,
       SUM(estado = 'apartada') AS unidades_apartadas,
       SUM(en_transito) AS unidades_en_transito
FROM v_existencias
GROUP BY bodega_codigo, articulo_codigo, tipo;

-- Balance por arete (§7.2 venta: balance = 0):
-- kg deshuesados = vendidos + mercadeo + descartes + ajustes + custodia + WC-01
--                  + en proceso + recorte declarado de porcionado + merma de reempaque
CREATE OR REPLACE VIEW v_balance_arete AS
SELECT a.arete,
       a.kg_deshuesado,
       COALESCE(h.kg_vendido, 0)      AS kg_vendido,
       COALESCE(h.kg_mercadeo, 0)     AS kg_mercadeo,
       COALESCE(h.kg_descartado, 0)   AS kg_descartado,
       COALESCE(h.kg_ajuste, 0)       AS kg_ajuste,
       COALESCE(h.kg_custodia, 0)     AS kg_custodia,
       COALESCE(h.kg_wc01, 0)         AS kg_wc01,
       COALESCE(h.kg_en_proceso, 0)   AS kg_en_proceso,
       COALESCE(r.kg_recorte, 0)      AS kg_recorte_declarado,
       COALESCE(m.kg_merma, 0)        AS kg_merma_reempaque,
       a.kg_deshuesado - ( COALESCE(h.kg_vendido,0) + COALESCE(h.kg_mercadeo,0) + COALESCE(h.kg_descartado,0)
                         + COALESCE(h.kg_ajuste,0) + COALESCE(h.kg_custodia,0) + COALESCE(h.kg_wc01,0)
                         + COALESCE(h.kg_en_proceso,0) + COALESCE(r.kg_recorte,0) + COALESCE(m.kg_merma,0) ) AS diferencia
FROM (
  SELECT arete, SUM(kg) AS kg_deshuesado
  FROM etiquetas
  WHERE origen_etapa = 'deshuese' AND activo = 1 AND arete IS NOT NULL
  GROUP BY arete
) a
LEFT JOIN (
  -- "hojas": etiquetas que no se transformaron en otras ni fueron reemplazadas por reempaque
  SELECT e.arete,
    SUM(CASE WHEN e.estado = 'vendida' AND e.motivo_salida = 'pedido'   THEN e.kg ELSE 0 END) AS kg_vendido,
    SUM(CASE WHEN e.estado = 'vendida' AND e.motivo_salida = 'mercadeo' THEN e.kg ELSE 0 END) AS kg_mercadeo,
    SUM(CASE WHEN e.estado = 'descartada' AND e.motivo_salida = 'descarte' THEN e.kg ELSE 0 END) AS kg_descartado,
    SUM(CASE WHEN e.estado = 'descartada' AND e.motivo_salida = 'ajuste'   THEN e.kg ELSE 0 END) AS kg_ajuste,
    SUM(CASE WHEN e.estado IN ('disponible','apartada','bloqueada') AND b.codigo = '107'   THEN e.kg ELSE 0 END) AS kg_custodia,
    SUM(CASE WHEN e.estado IN ('disponible','apartada','bloqueada') AND b.codigo = 'WC-01' THEN e.kg ELSE 0 END) AS kg_wc01,
    SUM(CASE WHEN (e.estado IN ('disponible','apartada','bloqueada') AND b.ambito_inventario = 'proceso')
               OR e.estado = 'devuelta' THEN e.kg ELSE 0 END) AS kg_en_proceso
  FROM etiquetas e
  LEFT JOIN bodegas b ON b.id = e.bodega_actual_id
  WHERE e.activo = 1 AND e.arete IS NOT NULL AND e.tipo <> 'interna_previa'
    AND e.estado <> 'transformada'
    AND NOT EXISTS (SELECT 1 FROM etiquetas n WHERE n.origen_reempaque_id = e.id)
  GROUP BY e.arete
) h ON h.arete = a.arete
LEFT JOIN (
  SELECT ep.arete, SUM(COALESCE(p.trimming_kg,0) + COALESCE(p.bch_kg,0)) AS kg_recorte
  FROM porcionado p
  JOIN etiquetas ep ON ep.id = p.etiqueta_primal_id
  GROUP BY ep.arete
) r ON r.arete = a.arete
LEFT JOIN (
  SELECT eo.arete, SUM(d.kg_antes - COALESCE(d.kg_despues, d.kg_antes)) AS kg_merma
  FROM devoluciones_reempaque d
  JOIN etiquetas eo ON eo.id = d.etiqueta_original_id
  WHERE d.estado = 'reempacada'
  GROUP BY eo.arete
) m ON m.arete = a.arete;

-- -----------------------------------------------------------------------------
-- 14. Datos semilla (idempotentes)
-- -----------------------------------------------------------------------------

INSERT INTO bodegas (codigo, nombre, tipo, naturaleza, ambito_inventario, empresa_custodio, empresa_propietaria, codigo_ciisa, activa)
VALUES
  ('DES',   'Sala de deshuese CIISA',               'deshuese',   'fisica',  'proceso',  'CIISA',       'WAGYU_CROSS', NULL,  1),
  ('107',   'EQTB Tempisque (custodia en CIISA)',   'custodia',   'virtual', 'custodia', 'CIISA',       'WAGYU_CROSS', '107', 1),
  ('MAD',   'Maduración CIISA',                     'maduracion', 'fisica',  'proceso',  'CIISA',       'WAGYU_CROSS', NULL,  1),
  ('12',    'Paquetería CIISA',                     'porcionado', 'fisica',  'proceso',  'CIISA',       'WAGYU_CROSS', '12',  1),
  ('WC-01', 'Bodega Wagyu Cross (tienda web)',      NULL,         'fisica',  'propio',   'WAGYU_CROSS', 'WAGYU_CROSS', NULL,  1)
ON DUPLICATE KEY UPDATE naturaleza = VALUES(naturaleza), ambito_inventario = VALUES(ambito_inventario),
  empresa_custodio = VALUES(empresa_custodio), codigo_ciisa = VALUES(codigo_ciisa);

UPDATE bodegas SET es_legacy = 1 WHERE codigo IN ('BOD-DES','BOD-CUS','BOD-MAD','BOD-POR','BOD-DSP');

INSERT INTO roles_etapa (codigo, empresa, nombre, etapas, puede_aceptar_dat) VALUES
  ('CIISA_RECEPTOR',     'CIISA', 'Receptor de planta / sacrificio', 'recepcion_planta,sacrificio', 0),
  ('CIISA_CALIDAD',      'CIISA', 'Técnico de calidad',              'calidad', 0),
  ('CIISA_DESHUESE_107', 'CIISA', 'Operario deshuese / bodega 107',  'deshuese,custodia_107', 0),
  ('CIISA_MADURACION',   'CIISA', 'Bodega maduración',               'maduracion', 0),
  ('CIISA_PAQUETERIA',   'CIISA', 'Operario paquetería',             'paqueteria', 0),
  ('CIISA_ENC_ARREO',    'CIISA', 'Encargado bodega El Arreo',       'custodia_107,despacho_arreo', 0),
  ('CIISA_SUPERVISOR',   'CIISA', 'Supervisor CIISA',                'recepcion_planta,sacrificio,calidad,deshuese,custodia_107,maduracion,paqueteria,despacho_arreo', 0),
  ('WC_ADMIN',           'WAGYU_CROSS', 'Administrador',             'recepcion_planta,sacrificio,calidad,deshuese,custodia_107,maduracion,paqueteria,despacho_arreo,recepcion_wc01,inventario_wc01,conciliacion,parametros,administracion', 1),
  ('WC_SUPERVISOR',      'WAGYU_CROSS', 'Supervisor',                'custodia_107,recepcion_wc01,inventario_wc01,conciliacion', 1),
  ('WC_BODEGA',          'WAGYU_CROSS', 'Bodega física WC-01',       'recepcion_wc01,inventario_wc01', 0)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- Bandas iniciales del doc (§7.2). El admin las ajusta con PIN.
INSERT INTO parametros_bandas (eslabon, cruce, sexo, minimo_pct, maximo_pct, tolerancia_pct, tolerancia_kg) VALUES
  ('merma_transporte', '*', '*',   3.000,   6.000, NULL,  NULL),
  ('matanza',          '*', '*',  NULL,    NULL,   NULL,  NULL),  -- ~60 %: falta rango exacto
  ('deshuese',         '*', '*',  80.000,  85.000, NULL,  NULL),
  ('custodia',         '*', '*', 100.000, 100.000, NULL,  0.500),
  ('porcionado',       '*', '*', 100.000, 100.000, NULL,  NULL),  -- sin merma: recorte declarado
  ('fondo_traslado',   '*', '*', 100.000, 100.000, 2.000, NULL),
  ('venta',            '*', '*', 100.000, 100.000, NULL,  0.000)  -- balance por arete = 0
ON DUPLICATE KEY UPDATE eslabon = eslabon;

-- Layouts PROVISIONALES (ver «Decisiones abiertas» en DISEÑO.md).
INSERT INTO formatos_etiqueta (tipo, version, longitud, simbologia, regex, descripcion) VALUES
  ('paquete', 'v1', 28, NULL,
   '^(?<arete>[A-Z0-9]{6})(?<articulo>[0-9]{5})(?<fecha>[0-9]{6})(?<lote>[0-9]{2})(?<gramos>[0-9]{5})(?<cruce>F1|FB)(?<marmoleo>[0-9]{2})$',
   'arete(6) código(5) DDMMAA(6) lote(2) gramos(5) F1/FB(2) marmoleo(2)'),
  ('caja', 'v1', 25, NULL,
   '^(?<articulo>[0-9]{5})(?<peso>[0-9]{5})(?<xxx>[0-9A-Z]{3})(?<fecha>[0-9]{6})(?<lote>[0-9]{4})(?<sufijo>[0-9A-Z]{2})$',
   'código(5) peso centésimas(5?) XXX(3) DDMMAA(6) lote(4) sufijo(2?) — anchos de peso y sufijo por confirmar'),
  ('primal', 'v1', 25, 'Code 39',
   '^(?<articulo>[0-9]{5})(?<box>[0-9]{3})(?<peso>[0-9]{5})(?<fecha>[0-9]{6})(?<lote>[0-9]{2})(?<sufijo>[0-9]{4})$',
   'código Arreo(5) box(3?) peso(5?) MMDDAA(6) lote(2) sufijo(4?) — anchos por confirmar')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- -----------------------------------------------------------------------------
-- Limpieza de ayudantes
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS v10_add_column;
DROP PROCEDURE IF EXISTS v10_modify_column;
DROP PROCEDURE IF EXISTS v10_add_index;
DROP PROCEDURE IF EXISTS v10_add_fk;
