// ── Núcleo de inventario v10: la parte que necesita la integración con la tienda ───────────
//
// Fase 1 de docs/integracion-tienda (diseño 05-nov-2026, §4.2). Se crea SOLO lo que la
// integración usa ya: bodegas v10 (12, 107, WC-01), formatos_etiqueta, etiquetas,
// movimientos_etiqueta (con sus triggers append-only), consecutivos e integracion_eventos.
//
// Regla de oro (ver la advertencia de database.js sobre el Reporte de Producción): cada tabla
// v10 se crea con la definición COMPLETA de docs/nucleo-inventario-v10/propuesta.sql, nunca
// recortada. Si se creara `etiquetas` a medias, el `CREATE TABLE IF NOT EXISTS` de la
// migración v10 completa se saltaría en silencio y quedaría un esquema distinto al diseñado.
// La prueba test/nucleo-v10-esquema.test.js compara columna por columna con propuesta.sql.
//
// Lo único que se difiere son las FK hacia tablas v10 que todavía no existen (lotes_deshuese,
// dat, log_autorizaciones). Van en FK_DIFERIDAS y se agregan solas en el arranque en que su
// tabla aparezca (el mismo patrón `v10_add_fk` de propuesta.sql).
//
// Todo es aditivo e idempotente: se puede correr en cada arranque.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Usuario técnico dueño de los movimientos que lleguen por la integración
// (movimientos_etiqueta.usuario_id es NOT NULL). No puede iniciar sesión: su contraseña es un
// hash de bytes aleatorios que nadie conoce y además auth.js rechaza el rol `servicio`.
const USUARIO_SERVICIO_TIENDA = 'integracion.tienda';

// ── Columnas v10 de bodegas (propuesta.sql §1.2, sin recortar) ──────────────────────────────
const BODEGAS_COLUMNAS = [
  ['naturaleza', "ENUM('fisica','virtual') NULL COMMENT 'Tipo física/virtual del doc v10. 107 es virtual (custodia dentro del sistema de CIISA)' AFTER tipo"],
  ['ambito_inventario', "ENUM('proceso','custodia','propio') NULL COMMENT 'proceso = salas CIISA (deshuese, maduración, paquetería); custodia = 107; propio = WC-01' AFTER naturaleza"],
  ['empresa_custodio', "ENUM('CIISA','WAGYU_CROSS') NULL COMMENT 'Quién tiene físicamente el producto' AFTER ambito_inventario"],
  ['empresa_propietaria', "ENUM('CIISA','WAGYU_CROSS') NOT NULL DEFAULT 'WAGYU_CROSS' COMMENT 'Dueño del inventario (el ganado es de WC aunque esté en CIISA)' AFTER empresa_custodio"],
  ['codigo_ciisa', "VARCHAR(10) NULL COMMENT 'Número de bodega en el sistema de CIISA (12, 107). Se usa para casar TRE/ASE/INV' AFTER empresa_propietaria"],
  ['cuenta_inventario_wc', "VARCHAR(30) NULL COMMENT 'Cuenta/bodega de inventario en Enlace (contabilidad EQTBL) para la exportación' AFTER codigo_ciisa"],
  ['es_legacy', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = bodega del modelo anterior (BOD-*), solo lectura tras el corte' AFTER cuenta_inventario_wc"],
];

// `tipo` se vuelve NULL-able (WC-01 no es una sala). Se conserva porque el frontend filtra por
// él (Custodia.jsx, Maduracion.jsx); en el corte v10 pasa a llamarse `sala`.
const BODEGAS_TIPO_NULLABLE = "ENUM('deshuese','custodia','maduracion','porcionado','despacho') NULL COMMENT 'LEGACY: sala física. Se renombra a sala en el corte'";

// Solo las bodegas que usa la integración. Las 5 BOD-* sembradas no se tocan (ni es_legacy:
// eso es parte del corte v10, no de esta fase). Valores idénticos a propuesta.sql §14.
const BODEGAS_V10 = [
  ['12', 'Paquetería CIISA', 'porcionado', 'fisica', 'proceso', 'CIISA', 'WAGYU_CROSS', '12'],
  ['107', 'EQTB Tempisque (custodia en CIISA)', 'custodia', 'virtual', 'custodia', 'CIISA', 'WAGYU_CROSS', '107'],
  ['WC-01', 'Bodega Wagyu Cross (tienda web)', null, 'fisica', 'propio', 'WAGYU_CROSS', 'WAGYU_CROSS', null],
];

const SQL_CONSECUTIVOS = `
CREATE TABLE IF NOT EXISTS consecutivos (
  serie   VARCHAR(10) NOT NULL COMMENT 'DAT, OT (orden traslado), OD (orden despacho), DES (descarte)...',
  anio    SMALLINT NOT NULL COMMENT 'Año del consecutivo (se reinicia cada año)',
  ultimo  INT NOT NULL DEFAULT 0 COMMENT 'Último número emitido; se toma con SELECT ... FOR UPDATE',
  PRIMARY KEY (serie, anio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Consecutivos sin huecos, p. ej. DAT-AAAA-NNNN'`;

const SQL_FORMATOS_ETIQUETA = `
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Layouts de las etiquetas CIISA; configurables sin deploy mientras se confirman'`;

// Semilla de propuesta.sql §14 (layouts provisionales, ver «Decisiones abiertas» A1/A2).
const FORMATOS_ETIQUETA_SEMILLA = [
  ['paquete', 'v1', 28, null,
    '^(?<arete>[A-Z0-9]{6})(?<articulo>[0-9]{5})(?<fecha>[0-9]{6})(?<lote>[0-9]{2})(?<gramos>[0-9]{5})(?<cruce>F1|FB)(?<marmoleo>[0-9]{2})$',
    'arete(6) código(5) DDMMAA(6) lote(2) gramos(5) F1/FB(2) marmoleo(2)'],
  ['caja', 'v1', 25, null,
    '^(?<articulo>[0-9]{5})(?<peso>[0-9]{5})(?<xxx>[0-9A-Z]{3})(?<fecha>[0-9]{6})(?<lote>[0-9]{4})(?<sufijo>[0-9A-Z]{2})$',
    'código(5) peso centésimas(5) XXX(3) DDMMAA(6) lote(4) sufijo(2) — el sufijo NO es el BMS (dueño, 07-nov-2026)'],
  ['primal', 'v1', 25, 'Code 39',
    '^(?<articulo>[0-9]{5})(?<box>[0-9]{3})(?<peso>[0-9]{5})(?<fecha>[0-9]{6})(?<lote>[0-9]{2})(?<sufijo>[0-9]{4})$',
    'código Arreo(5) box(3?) peso(5?) MMDDAA(6) lote(2) sufijo(4?) — anchos por confirmar'],
];

// propuesta.sql §5 + ajustes de la integración (anotados en DISEÑO.md §3.4):
//   * `copia` + UNIQUE (codigo_crudo, copia): dos paquetes pueden traer la misma etiqueta
//     legítimamente; mismo criterio que reporte_produccion_escaneos (uk_rpe_codigo).
//   * `tienda_pieza_id`: id de la pieza en la tienda, solo como referencia (nunca se cruza por id).
// fk_etq_lote (lotes_deshuese) va en FK_DIFERIDAS: esa tabla todavía no existe.
const SQL_ETIQUETAS = `
CREATE TABLE IF NOT EXISTS etiquetas (
  id                 INT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  codigo_crudo       VARCHAR(64) NOT NULL COMMENT 'Lectura exacta del escáner (normalizada: mayúsculas, sin espacios): es la llave (§ etiquetas CIISA)',
  copia              SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '>1 solo si el operador confirmó que es OTRA unidad con la misma etiqueta (mismo criterio que reporte_produccion_escaneos)',
  tipo               ENUM('paquete','caja','primal','interna_previa') NOT NULL COMMENT 'interna_previa = sticker del modelo anterior, inactivo',
  formato_id         INT NULL COMMENT 'FK formatos_etiqueta usado para decodificar',
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
  marmoleo           TINYINT UNSIGNED NULL COMMENT 'BMS 2 díg. del paquete (0–12); la caja no trae BMS',
  box_codigo         VARCHAR(10) NULL COMMENT 'Campo box del primal',
  campo_xxx          VARCHAR(10) NULL COMMENT 'Campo XXX de la caja (significado por confirmar)',
  sufijo             VARCHAR(10) NULL COMMENT 'Sufijo crudo de caja o primal (pos. 24–25): NO es el BMS',
  decodificado       JSON NULL COMMENT 'Resultado completo del parser, para auditoría',
  caja_padre_id      INT NULL COMMENT 'Caja que contiene este paquete (FK etiquetas)',
  primal_origen_id   INT NULL COMMENT 'Primal del que salió por porcionado (FK etiquetas)',
  origen_reempaque_id INT NULL COMMENT 'Etiqueta original si esta es un reempaque (misma pieza, nueva bolsa)',
  origen_etapa       ENUM('deshuese','porcionado','paqueteria','reempaque','migracion') NOT NULL COMMENT 'Dónde nació la etiqueta; deshuese define los kg deshuesados del balance',
  primal_legacy_id   INT NULL COMMENT 'FK primales.id del modelo anterior',
  tienda_pieza_id    VARCHAR(64) NULL COMMENT 'Id de la pieza en la tienda (wagyu-demo), solo referencia: la llave común es (codigo_crudo, copia)',
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
  UNIQUE KEY uk_etq_codigo (codigo_crudo, copia),
  KEY idx_etq_bodega_estado (bodega_actual_id, estado),
  KEY idx_etq_arete (arete),
  KEY idx_etq_lote (lote_deshuese_id),
  KEY idx_etq_caja (caja_padre_id),
  KEY idx_etq_articulo (articulo_codigo),
  KEY idx_etq_dat (dat_pendiente_id),
  KEY idx_etq_tienda_pieza (tienda_pieza_id),
  CONSTRAINT fk_etq_formato FOREIGN KEY (formato_id) REFERENCES formatos_etiqueta(id),
  CONSTRAINT fk_etq_animal FOREIGN KEY (animal_id) REFERENCES animales(id),
  CONSTRAINT fk_etq_articulo FOREIGN KEY (articulo_id) REFERENCES catalogo_cortes(id),
  CONSTRAINT fk_etq_caja FOREIGN KEY (caja_padre_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_etq_primal FOREIGN KEY (primal_origen_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_etq_reempaque FOREIGN KEY (origen_reempaque_id) REFERENCES etiquetas(id),
  CONSTRAINT fk_etq_primal_legacy FOREIGN KEY (primal_legacy_id) REFERENCES primales(id) ON DELETE SET NULL,
  CONSTRAINT fk_etq_bodega FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Unidad de inventario (paquete, caja, primal). Existencia = suma de etiquetas'`;

// propuesta.sql §9 + ajuste de la integración: documento_tipo suma `integracion_tienda` (evento
// recibido de la tienda) y `planta` (venta del canal planta). fk_me_aut (log_autorizaciones)
// va en FK_DIFERIDAS.
const SQL_MOVIMIENTOS_ETIQUETA = `
CREATE TABLE IF NOT EXISTS movimientos_etiqueta (
  id                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  etiqueta_id       INT NOT NULL COMMENT 'FK etiquetas',
  tipo              ENUM('alta','dat','recepcion','apartado','liberacion','despacho','devolucion','reempaque','descarte','ajuste','transformacion','empaque_en_caja') NOT NULL COMMENT 'Qué lo originó',
  bodega_origen_id  INT NULL COMMENT 'Bodega antes',
  bodega_destino_id INT NULL COMMENT 'Bodega después (NULL = salió del inventario)',
  estado_anterior   VARCHAR(20) NULL COMMENT 'Estado antes',
  estado_nuevo      VARCHAR(20) NOT NULL COMMENT 'Estado después',
  kg                DECIMAL(10,3) NOT NULL COMMENT 'kg de la etiqueta en ese momento',
  documento_tipo    ENUM('dat','orden_traslado','orden_despacho','devolucion_reempaque','descarte','ajuste','porcionado','migracion','integracion_tienda','planta') NOT NULL COMMENT 'Documento origen (nunca manual). integracion_tienda = integracion_eventos.id',
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
  CONSTRAINT fk_me_user FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Kardex por etiqueta. Solo lo escribe el backend al ejecutar un documento'`;

// Tabla propia de la integración (no es v10). Idempotencia por `clave` (una por documento de
// negocio, la genera la tienda al encolar). Se guarda el sha256 del cuerpo crudo para distinguir
// «mismo evento reenviado» (se devuelve el resultado guardado) de «misma clave con otro
// contenido» (409). El payload queda para revisar el modo sombra y para la exportación a Enlace.
const SQL_INTEGRACION_EVENTOS = `
CREATE TABLE IF NOT EXISTS integracion_eventos (
  id            BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
  clave         VARCHAR(160) NOT NULL COMMENT 'Clave de idempotencia: <tipo>:<id del documento en la tienda>',
  tipo          VARCHAR(40) NOT NULL COMMENT 'venta.salida, baja.aplicada, traslado.recibido...',
  origen_app    VARCHAR(20) NOT NULL DEFAULT 'tienda' COMMENT 'Quién lo envió',
  version_contrato TINYINT UNSIGNED NOT NULL COMMENT 'Campo v del sobre',
  hash_cuerpo   CHAR(64) NOT NULL COMMENT 'sha256 hex del cuerpo crudo recibido',
  modo          ENUM('sombra','encendido') NOT NULL COMMENT 'Modo de la integración al recibirlo (sombra = solo se validó)',
  estado        ENUM('registrado','aplicado') NOT NULL DEFAULT 'registrado' COMMENT 'registrado = validado sin mover inventario (sombra). Un registrado NO cuenta como aplicado',
  avisos        SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Cantidad de avisos devueltos (detalle en resultado)',
  payload       JSON NOT NULL COMMENT 'Sobre completo tal como llegó',
  resultado     JSON NOT NULL COMMENT 'Respuesta devuelta a la tienda (se repite tal cual en los reenvíos)',
  ocurrido_en   DATETIME(3) NULL COMMENT 'Cuándo ocurrió en la tienda (ocurrido_en del sobre)',
  recibido_en   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'Primera recepción',
  procesado_en  DATETIME(3) NULL COMMENT 'Cuándo se aplicó al inventario (NULL en sombra)',
  PRIMARY KEY (id),
  UNIQUE KEY uk_ie_clave (clave),
  KEY idx_ie_tipo (tipo, recibido_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Eventos recibidos de la tienda: idempotencia y bitácora de la integración'`;

// Triggers de propuesta.sql §12 (kardex append-only). Se crean solo si faltan, sin DROP, para
// no dejar una ventana sin candado en cada arranque.
const TRIGGERS_MOVIMIENTOS = [
  ['trg_me_no_update', `CREATE TRIGGER trg_me_no_update BEFORE UPDATE ON movimientos_etiqueta FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'movimientos_etiqueta es append-only: registre un movimiento inverso';
END`],
  ['trg_me_no_delete', `CREATE TRIGGER trg_me_no_delete BEFORE DELETE ON movimientos_etiqueta FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'movimientos_etiqueta es append-only';
END`],
];

// FK v10 hacia tablas que todavía no existen. Se agregan en el primer arranque en que su tabla
// exista (cuando entre el resto del núcleo v10). Definiciones copiadas de propuesta.sql.
const FK_DIFERIDAS = [
  { tabla: 'etiquetas', fk: 'fk_etq_lote', requiere: 'lotes_deshuese', def: 'FOREIGN KEY (lote_deshuese_id) REFERENCES lotes_deshuese(id)' },
  { tabla: 'etiquetas', fk: 'fk_etq_dat_pendiente', requiere: 'dat', def: 'FOREIGN KEY (dat_pendiente_id) REFERENCES dat(id) ON DELETE SET NULL' },
  { tabla: 'movimientos_etiqueta', fk: 'fk_me_aut', requiere: 'log_autorizaciones', def: 'FOREIGN KEY (autorizacion_id) REFERENCES log_autorizaciones(id)' },
];

// ── Ayudantes idempotentes (equivalentes JS de v10_add_column / v10_add_fk) ───────────────────
// Los nombres de tabla/columna salen de las constantes de este archivo, nunca del request.
async function existeTabla(conn, tabla) {
  const [r] = await conn.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1', [tabla]);
  return r.length > 0;
}

async function columna(conn, tabla, col) {
  const [r] = await conn.query(
    `SELECT COLUMN_TYPE AS tipo, IS_NULLABLE AS nulable FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [tabla, col]);
  return r[0] || null;
}

async function agregarColumna(conn, tabla, col, def) {
  if (await columna(conn, tabla, col)) return false;
  await conn.query(`ALTER TABLE \`${tabla}\` ADD COLUMN \`${col}\` ${def}`);
  return true;
}

async function existeConstraint(conn, tabla, nombre) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? LIMIT 1`, [tabla, nombre]);
  return r.length > 0;
}

async function agregarFk(conn, tabla, fk, def) {
  if (await existeConstraint(conn, tabla, fk)) return false;
  await conn.query(`ALTER TABLE \`${tabla}\` ADD CONSTRAINT \`${fk}\` ${def}`);
  return true;
}

async function existeIndice(conn, tabla, indice) {
  const [r] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`, [tabla, indice]);
  return r.length > 0;
}

/**
 * Migración de la base de integración. Cada paso registra su error con la consecuencia y sigue:
 * un fallo aquí no debe tumbar el arranque del resto de la app (mismo criterio que
 * `ignorarSiExiste` en database.js), pero tampoco se traga en silencio.
 */
async function migrarBaseIntegracion(conn) {
  const paso = async (nombre, fn, consecuencia) => {
    try { await fn(); } catch (e) {
      console.error(`[initDB:v10] ${nombre}: ${e.code || 'ERROR'} ${e.message} — ${consecuencia}`);
    }
  };
  const SIN_INTEGRACION = 'la integración con la tienda NO va a funcionar hasta corregirlo';

  await paso('consecutivos', () => conn.query(SQL_CONSECUTIVOS),
    'las órdenes de salida/entrada no podrán numerarse (fallarán al crear)');

  // usuarios.rol: se agrega `servicio` al final del ENUM (no cambia los valores existentes).
  await paso('usuarios.rol', async () => {
    const c = await columna(conn, 'usuarios', 'rol');
    if (c && !String(c.tipo).includes("'servicio'")) {
      await conn.query("ALTER TABLE usuarios MODIFY COLUMN rol ENUM('admin','operador','viewer','servicio') DEFAULT 'operador'");
    }
  }, SIN_INTEGRACION);

  await paso('bodegas v10', async () => {
    const tipo = await columna(conn, 'bodegas', 'tipo');
    if (tipo && tipo.nulable !== 'YES') {
      await conn.query(`ALTER TABLE bodegas MODIFY COLUMN tipo ${BODEGAS_TIPO_NULLABLE}`);
    }
    for (const [col, def] of BODEGAS_COLUMNAS) await agregarColumna(conn, 'bodegas', col, def);
    for (const b of BODEGAS_V10) {
      await conn.query(`
        INSERT INTO bodegas (codigo, nombre, tipo, naturaleza, ambito_inventario, empresa_custodio, empresa_propietaria, codigo_ciisa, activa)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE naturaleza = VALUES(naturaleza), ambito_inventario = VALUES(ambito_inventario),
          empresa_custodio = VALUES(empresa_custodio), codigo_ciisa = VALUES(codigo_ciisa)
      `, b);
    }
  }, SIN_INTEGRACION);

  await paso('formatos_etiqueta', async () => {
    await conn.query(SQL_FORMATOS_ETIQUETA);
    for (const f of FORMATOS_ETIQUETA_SEMILLA) {
      await conn.query(`
        INSERT INTO formatos_etiqueta (tipo, version, longitud, simbologia, regex, descripcion) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion)
      `, f);
    }
  }, SIN_INTEGRACION);

  await paso('etiquetas', () => conn.query(SQL_ETIQUETAS), SIN_INTEGRACION);
  await paso('movimientos_etiqueta', () => conn.query(SQL_MOVIMIENTOS_ETIQUETA), SIN_INTEGRACION);

  // Los triggers pueden fallar con binlog activo y un usuario sin SUPER (ER 1419). La app no
  // depende de ellos (nunca hace UPDATE/DELETE del kardex), son la red de seguridad: se avisa y
  // se deja el SQL listo para correrlo como root (backend/migraciones/).
  for (const [nombre, sql] of TRIGGERS_MOVIMIENTOS) {
    await paso(`trigger ${nombre}`, async () => {
      const [r] = await conn.query(
        'SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ? LIMIT 1', [nombre]);
      if (!r.length && await existeTabla(conn, 'movimientos_etiqueta')) await conn.query(sql);
    }, 'el kardex movimientos_etiqueta queda sin candado append-only; correr backend/migraciones/2026-11-05-triggers-movimientos-etiqueta.sql como root');
  }

  await paso('integracion_eventos', () => conn.query(SQL_INTEGRACION_EVENTOS), SIN_INTEGRACION);

  for (const f of FK_DIFERIDAS) {
    await paso(`fk ${f.fk}`, async () => {
      if (await existeTabla(conn, f.tabla) && await existeTabla(conn, f.requiere)) await agregarFk(conn, f.tabla, f.fk, f.def);
    }, `falta la FK ${f.tabla} → ${f.requiere}`);
  }

  // Órdenes de salida: destino como bodega (para saber cuáles van a WC-01) y momento exacto del
  // despacho (cursor de la consulta de la tienda). `updated_at` no sirve de cursor: cambia con
  // cualquier edición y tiene resolución de segundos.
  await paso('ordenes_salida destino/despacho', async () => {
    await agregarColumna(conn, 'ordenes_salida', 'bodega_destino_id',
      "INT NULL COMMENT 'Bodega de destino (WC-01 = traslado a la tienda)' AFTER bodega_origen_id");
    await agregarColumna(conn, 'ordenes_salida', 'despachada_en',
      "DATETIME(3) NULL COMMENT 'Momento del despacho (cursor de /api/integracion/tienda/despachos)' AFTER estado");
    await agregarFk(conn, 'ordenes_salida', 'fk_os_bodega_destino',
      'FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id) ON DELETE SET NULL');
    if (!await existeIndice(conn, 'ordenes_salida', 'idx_os_despacho')) {
      await conn.query('CREATE INDEX idx_os_despacho ON ordenes_salida (estado, bodega_destino_id, despachada_en, id)');
    }
    // Las despachadas antes de esta columna toman su última modificación (la mejor aproximación).
    // `updated_at = updated_at` evita que el ON UPDATE CURRENT_TIMESTAMP las marque como editadas hoy.
    await conn.query("UPDATE ordenes_salida SET despachada_en = updated_at, updated_at = updated_at WHERE estado = 'despachada' AND despachada_en IS NULL");
  }, 'la consulta de despachos hacia WC-01 no va a funcionar');

  await paso('usuario de servicio', async () => {
    const [r] = await conn.query('SELECT id, rol FROM usuarios WHERE username = ?', [USUARIO_SERVICIO_TIENDA]);
    if (!r.length) {
      const inutilizable = bcrypt.hashSync(crypto.randomBytes(48).toString('hex'), 12);
      await conn.query(
        "INSERT INTO usuarios (username, password, nombre, rol, activo) VALUES (?, ?, 'Integración tienda (servicio)', 'servicio', 1)",
        [USUARIO_SERVICIO_TIENDA, inutilizable]);
    } else if (r[0].rol !== 'servicio') {
      console.error(`[initDB:v10] El usuario ${USUARIO_SERVICIO_TIENDA} existe con rol ${r[0].rol}: la integración no lo usará hasta que tenga rol servicio`);
    }
  }, SIN_INTEGRACION);
}

module.exports = {
  migrarBaseIntegracion,
  USUARIO_SERVICIO_TIENDA,
  SQL_ETIQUETAS,
  SQL_MOVIMIENTOS_ETIQUETA,
  SQL_FORMATOS_ETIQUETA,
  SQL_CONSECUTIVOS,
  SQL_INTEGRACION_EVENTOS,
  BODEGAS_COLUMNAS,
  BODEGAS_V10,
  FK_DIFERIDAS,
  TRIGGERS_MOVIMIENTOS,
};
