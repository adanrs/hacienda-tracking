const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'hacienda_admin',
  password: process.env.DB_PASSWORD || 'hacienda_pass',
  database: process.env.DB_NAME || 'hacienda_tracking',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nombre VARCHAR(200) NOT NULL,
        email VARCHAR(200),
        rol ENUM('admin','operador','viewer') DEFAULT 'operador',
        activo TINYINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS potreros (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        superficie_ha DECIMAL(10,2),
        capacidad_animales INT,
        estado ENUM('activo','inactivo','mantenimiento') DEFAULT 'activo',
        ubicacion_gps VARCHAR(100),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS animales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero_trazabilidad VARCHAR(50) UNIQUE NOT NULL,
        nombre VARCHAR(200),
        tipo ENUM('bovino','equino','bufalino') NOT NULL,
        raza VARCHAR(100),
        sexo ENUM('macho','hembra') NOT NULL,
        fecha_nacimiento DATE,
        peso_nacimiento DECIMAL(8,2),
        peso_actual DECIMAL(8,2),
        color VARCHAR(50),
        marca_hierro VARCHAR(100),
        estado ENUM('activo','vendido','muerto','trasladado') DEFAULT 'activo',
        madre_id INT,
        padre_id INT,
        potrero_id INT,
        foto_url VARCHAR(500),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (madre_id) REFERENCES animales(id) ON DELETE SET NULL,
        FOREIGN KEY (padre_id) REFERENCES animales(id) ON DELETE SET NULL,
        FOREIGN KEY (potrero_id) REFERENCES potreros(id) ON DELETE SET NULL,
        INDEX idx_trazabilidad (numero_trazabilidad),
        INDEX idx_potrero (potrero_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pesajes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        animal_id INT NOT NULL,
        peso_kg DECIMAL(8,2) NOT NULL,
        fecha DATE NOT NULL,
        tipo ENUM('rutinario','nacimiento','destete','venta','entrada') DEFAULT 'rutinario',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        INDEX idx_animal (animal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS eventos_salud (
        id INT AUTO_INCREMENT PRIMARY KEY,
        animal_id INT NOT NULL,
        tipo ENUM('vacunacion','desparasitacion','tratamiento','cirugia','examen','otro') NOT NULL,
        fecha DATE NOT NULL,
        descripcion TEXT NOT NULL,
        producto VARCHAR(200),
        dosis VARCHAR(100),
        veterinario VARCHAR(200),
        costo DECIMAL(10,2) DEFAULT 0,
        proxima_fecha DATE,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        INDEX idx_animal (animal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS movimientos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        animal_id INT NOT NULL,
        potrero_origen_id INT,
        potrero_destino_id INT,
        fecha DATE NOT NULL,
        motivo TEXT,
        responsable VARCHAR(200),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        FOREIGN KEY (potrero_origen_id) REFERENCES potreros(id) ON DELETE SET NULL,
        FOREIGN KEY (potrero_destino_id) REFERENCES potreros(id) ON DELETE SET NULL,
        INDEX idx_animal (animal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS reproduccion (
        id INT AUTO_INCREMENT PRIMARY KEY,
        hembra_id INT NOT NULL,
        macho_id INT,
        tipo ENUM('monta_natural','inseminacion_artificial','transferencia_embrion') NOT NULL,
        fecha_servicio DATE NOT NULL,
        fecha_parto_estimada DATE,
        fecha_parto_real DATE,
        cria_id INT,
        resultado ENUM('gestante','vacia','aborto','parto_exitoso','parto_complicado'),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (hembra_id) REFERENCES animales(id) ON DELETE CASCADE,
        FOREIGN KEY (macho_id) REFERENCES animales(id) ON DELETE SET NULL,
        FOREIGN KEY (cria_id) REFERENCES animales(id) ON DELETE SET NULL,
        INDEX idx_hembra (hembra_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS transporte (
        id INT AUTO_INCREMENT PRIMARY KEY,
        animal_id INT NOT NULL,
        tipo ENUM('finca','feria','matadero','otro') DEFAULT 'otro',
        destino VARCHAR(300),
        fecha_salida DATETIME NOT NULL,
        fecha_llegada DATETIME,
        transportista VARCHAR(200),
        placa_vehiculo VARCHAR(20),
        guia_movilizacion VARCHAR(100),
        estado ENUM('programado','en_transito','recibido','cancelado') DEFAULT 'programado',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        INDEX idx_animal (animal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sacrificios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        animal_id INT NOT NULL,
        fecha DATETIME NOT NULL,
        peso_vivo DECIMAL(8,2),
        peso_canal_caliente DECIMAL(8,2),
        peso_canal_frio DECIMAL(8,2),
        rendimiento_canal DECIMAL(5,2),
        marmoleo INT,
        fecha_colgado DATETIME,
        inspector VARCHAR(200),
        resultado_inspeccion ENUM('aprobado','rechazado','condicionado') DEFAULT 'aprobado',
        lote_sacrificio VARCHAR(50),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_animal (animal_id),
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        INDEX idx_animal (animal_id)
      )
    `);

    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN marmoleo INT AFTER rendimiento_canal`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN fecha_colgado DATETIME AFTER marmoleo`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN ojo_ribeye_cm2 DECIMAL(6,2) AFTER marmoleo`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN fecha_marmoleo DATETIME AFTER ojo_ribeye_cm2`); } catch (e) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS cortes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sacrificio_id INT NOT NULL,
        animal_id INT NOT NULL,
        tipo_corte VARCHAR(100) NOT NULL,
        peso_kg DECIMAL(8,2) NOT NULL,
        calidad ENUM('primera','segunda','exportacion') DEFAULT 'primera',
        destino VARCHAR(200),
        lote_empaque VARCHAR(50),
        fecha_empaque DATE,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sacrificio_id) REFERENCES sacrificios(id) ON DELETE CASCADE,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        INDEX idx_sacrificio (sacrificio_id),
        INDEX idx_animal (animal_id)
      )
    `);

    // Add 'sacrificado' to animales estado ENUM if not already present
    try {
      await conn.query(`
        ALTER TABLE animales MODIFY COLUMN estado ENUM('activo','vendido','muerto','trasladado','sacrificado') DEFAULT 'activo'
      `);
    } catch (e) {
      // Ignore if already modified
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS bodegas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(200) NOT NULL,
        tipo ENUM('deshuese','custodia','maduracion','porcionado','despacho') NOT NULL,
        temperatura_c DECIMAL(5,2),
        capacidad_kg DECIMAL(10,2),
        activa TINYINT DEFAULT 1,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS deshuese (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero_lote VARCHAR(50) UNIQUE NOT NULL,
        sacrificio_id INT NOT NULL,
        animal_id INT NOT NULL,
        fecha DATETIME NOT NULL,
        peso_entrada DECIMAL(8,2),
        responsable VARCHAR(200),
        pdf_url VARCHAR(500),
        estado ENUM('abierto','cerrado','reabierto') DEFAULT 'abierto',
        bodega_origen_id INT,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (sacrificio_id) REFERENCES sacrificios(id) ON DELETE CASCADE,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id) ON DELETE SET NULL,
        INDEX idx_animal (animal_id),
        INDEX idx_sacrificio (sacrificio_id),
        INDEX idx_lote (numero_lote)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS primales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        deshuese_id INT NOT NULL,
        animal_id INT NOT NULL,
        tipo_primal VARCHAR(100) NOT NULL,
        peso_kg DECIMAL(8,3) NOT NULL,
        peso_prorrateado DECIMAL(8,3),
        marmoleo INT,
        bodega_actual_id INT,
        estado ENUM('en_deshuese','en_custodia','en_maduracion','en_porcionado','porcionado','descartado') DEFAULT 'en_deshuese',
        fecha_ingreso_custodia DATETIME,
        fecha_maduracion_inicio DATETIME,
        dias_maduracion INT DEFAULT 0,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (deshuese_id) REFERENCES deshuese(id) ON DELETE CASCADE,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id) ON DELETE SET NULL,
        INDEX idx_deshuese (deshuese_id),
        INDEX idx_animal (animal_id),
        INDEX idx_estado (estado)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS movimientos_bodega (
        id INT AUTO_INCREMENT PRIMARY KEY,
        primal_id INT NOT NULL,
        bodega_origen_id INT,
        bodega_destino_id INT,
        tipo ENUM('ingreso_custodia','paso_maduracion','salida_porcionado','devolucion','otro') NOT NULL,
        fecha DATETIME NOT NULL,
        responsable VARCHAR(200),
        orden_salida_id INT,
        confirmado TINYINT DEFAULT 0,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE CASCADE,
        FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id) ON DELETE SET NULL,
        FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id) ON DELETE SET NULL,
        INDEX idx_primal (primal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS porcionado (
        id INT AUTO_INCREMENT PRIMARY KEY,
        primal_id INT NOT NULL,
        animal_id INT NOT NULL,
        fecha DATETIME NOT NULL,
        peso_inicial DECIMAL(8,3) NOT NULL,
        peso_final DECIMAL(8,3) NOT NULL,
        trimming_kg DECIMAL(8,3) DEFAULT 0,
        bch_kg DECIMAL(8,3) DEFAULT 0,
        destino_trimming ENUM('carne_molida','chorizo','tortas','descarte','otro'),
        responsable VARCHAR(200),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE CASCADE,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        INDEX idx_primal (primal_id),
        INDEX idx_animal (animal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS cajas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(50) UNIQUE NOT NULL,
        porcionado_id INT,
        tipo_corte VARCHAR(100) NOT NULL,
        peso_total_kg DECIMAL(8,3) NOT NULL,
        num_stickers INT DEFAULT 0,
        estado ENUM('abierta','completa','despachada','devuelta') DEFAULT 'abierta',
        bodega_actual_id INT,
        fecha_empaque DATETIME,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (porcionado_id) REFERENCES porcionado(id) ON DELETE SET NULL,
        FOREIGN KEY (bodega_actual_id) REFERENCES bodegas(id) ON DELETE SET NULL,
        INDEX idx_porcionado (porcionado_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS stickers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo_barras VARCHAR(100) UNIQUE NOT NULL,
        caja_id INT NOT NULL,
        porcionado_id INT NOT NULL,
        animal_id INT NOT NULL,
        primal_id INT,
        tipo_corte VARCHAR(100) NOT NULL,
        peso_kg DECIMAL(8,3) NOT NULL,
        marmoleo INT,
        lote VARCHAR(50),
        fecha_empaque DATETIME,
        escaneado TINYINT DEFAULT 0,
        fecha_escaneo DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE CASCADE,
        FOREIGN KEY (porcionado_id) REFERENCES porcionado(id) ON DELETE CASCADE,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE SET NULL,
        INDEX idx_caja (caja_id),
        INDEX idx_animal (animal_id),
        INDEX idx_codigo (codigo_barras)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS ordenes_salida (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(50) UNIQUE NOT NULL,
        fecha DATETIME NOT NULL,
        solicitante VARCHAR(200),
        destino VARCHAR(300),
        bodega_origen_id INT,
        estado ENUM('pendiente','en_preparacion','despachada','cancelada') DEFAULT 'pendiente',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (bodega_origen_id) REFERENCES bodegas(id) ON DELETE SET NULL
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS ordenes_salida_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orden_id INT NOT NULL,
        caja_id INT,
        primal_id INT,
        cantidad INT DEFAULT 1,
        peso_kg DECIMAL(8,3),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (orden_id) REFERENCES ordenes_salida(id) ON DELETE CASCADE,
        FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE SET NULL,
        INDEX idx_orden (orden_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS devoluciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        caja_id INT,
        sticker_id INT,
        primal_id INT,
        motivo ENUM('perdida_vacio','producto_danado','error_empaque','vencido','otro') NOT NULL,
        fecha DATETIME NOT NULL,
        responsable VARCHAR(200),
        peso_kg DECIMAL(8,3),
        reprocesado TINYINT DEFAULT 0,
        fecha_reproceso DATETIME,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL,
        FOREIGN KEY (sticker_id) REFERENCES stickers(id) ON DELETE SET NULL,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE SET NULL
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS productos_paqueteria (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero_lote VARCHAR(50) UNIQUE NOT NULL,
        tipo_producto ENUM('carne_molida','chorizo','tortas','hamburguesa','otro') NOT NULL,
        fecha DATETIME NOT NULL,
        peso_entrada_kg DECIMAL(10,3) NOT NULL,
        peso_final_kg DECIMAL(10,3),
        rendimiento_pct DECIMAL(5,2),
        aditivos_kg DECIMAL(8,3) DEFAULT 0,
        responsable VARCHAR(200),
        estado ENUM('en_proceso','terminado','despachado') DEFAULT 'en_proceso',
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_lote (numero_lote),
        INDEX idx_tipo (tipo_producto)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS paqueteria_fuentes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        paqueteria_id INT NOT NULL,
        animal_id INT NOT NULL,
        origen ENUM('trim','bch','porcionado_trim','porcionado_bch','otro') NOT NULL,
        peso_kg DECIMAL(8,3) NOT NULL,
        porcionado_id INT,
        deshuese_id INT,
        proporcion_pct DECIMAL(5,2),
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paqueteria_id) REFERENCES productos_paqueteria(id) ON DELETE CASCADE,
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
        FOREIGN KEY (porcionado_id) REFERENCES porcionado(id) ON DELETE SET NULL,
        FOREIGN KEY (deshuese_id) REFERENCES deshuese(id) ON DELETE SET NULL,
        INDEX idx_paqueteria (paqueteria_id),
        INDEX idx_animal (animal_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS ordenes_entrada (
        id INT AUTO_INCREMENT PRIMARY KEY,
        numero VARCHAR(50) UNIQUE NOT NULL,
        fecha DATETIME NOT NULL,
        origen VARCHAR(300),
        bodega_destino_id INT,
        estado ENUM('pendiente','recibida','cancelada') DEFAULT 'pendiente',
        responsable VARCHAR(200),
        fecha_recepcion DATETIME,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (bodega_destino_id) REFERENCES bodegas(id) ON DELETE SET NULL
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS ordenes_entrada_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orden_id INT NOT NULL,
        primal_id INT,
        caja_id INT,
        cantidad INT DEFAULT 1,
        peso_esperado_kg DECIMAL(8,3),
        peso_recibido_kg DECIMAL(8,3),
        recibido TINYINT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (orden_id) REFERENCES ordenes_entrada(id) ON DELETE CASCADE,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE SET NULL,
        FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL,
        INDEX idx_orden (orden_id)
      )
    `);

    try { await conn.query(`ALTER TABLE movimientos_bodega MODIFY COLUMN tipo ENUM('ingreso_custodia','paso_maduracion','salida_porcionado','devolucion','recepcion_entrada','otro') NOT NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE movimientos_bodega ADD COLUMN orden_entrada_id INT AFTER orden_salida_id`); } catch (e) {}

    try { await conn.query(`ALTER TABLE transporte ADD COLUMN tipo_pasaje VARCHAR(10) AFTER tipo`); } catch (e) {}
    try { await conn.query(`ALTER TABLE transporte ADD COLUMN satisface_retiro TINYINT DEFAULT 0 AFTER tipo_pasaje`); } catch (e) {}
    try { await conn.query(`ALTER TABLE transporte ADD COLUMN peso_pie_finca DECIMAL(8,2) AFTER satisface_retiro`); } catch (e) {}
    try { await conn.query(`ALTER TABLE transporte ADD COLUMN condicion_corporal INT AFTER peso_pie_finca`); } catch (e) {}

    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN tipo_pasaje VARCHAR(10) AFTER lote_sacrificio`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN musculo INT AFTER ojo_ribeye_cm2`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN denticion INT AFTER musculo`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN encarnada VARCHAR(50) AFTER denticion`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN golpe VARCHAR(100) AFTER encarnada`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN ph_24h DECIMAL(5,2) AFTER golpe`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN temp_24h DECIMAL(5,2) AFTER ph_24h`); } catch (e) {}

    try { await conn.query(`ALTER TABLE primales ADD COLUMN ubicacion_bodega VARCHAR(100) AFTER bodega_actual_id`); } catch (e) {}
    try { await conn.query(`ALTER TABLE primales ADD COLUMN dias_maduracion_target INT DEFAULT 30 AFTER dias_maduracion`); } catch (e) {}
    try { await conn.query(`ALTER TABLE primales ADD COLUMN nota_supervisor TEXT AFTER notas`); } catch (e) {}
    try { await conn.query(`ALTER TABLE primales ADD COLUMN congelado TINYINT DEFAULT 0 AFTER estado`); } catch (e) {}
    try { await conn.query(`ALTER TABLE primales ADD COLUMN fecha_congelado DATETIME AFTER congelado`); } catch (e) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS temperaturas_maduracion (
        id INT AUTO_INCREMENT PRIMARY KEY,
        bodega_id INT,
        primal_id INT,
        fecha DATETIME NOT NULL,
        temperatura_c DECIMAL(5,2) NOT NULL,
        responsable VARCHAR(200),
        cumple TINYINT DEFAULT 1,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bodega_id) REFERENCES bodegas(id) ON DELETE CASCADE,
        FOREIGN KEY (primal_id) REFERENCES primales(id) ON DELETE SET NULL,
        INDEX idx_bodega_fecha (bodega_id, fecha),
        INDEX idx_primal (primal_id)
      )
    `);

    try { await conn.query(`ALTER TABLE paqueteria_fuentes ADD COLUMN temporalidad ENUM('fresco','madurado','congelado') DEFAULT 'fresco' AFTER origen`); } catch (e) {}
    try { await conn.query(`ALTER TABLE paqueteria_fuentes ADD COLUMN dias_desde_deshuese INT AFTER temporalidad`); } catch (e) {}
    try { await conn.query(`ALTER TABLE paqueteria_fuentes ADD COLUMN codigo_box VARCHAR(20) AFTER dias_desde_deshuese`); } catch (e) {}
    try { await conn.query(`ALTER TABLE paqueteria_fuentes ADD COLUMN codigo_lot VARCHAR(20) AFTER codigo_box`); } catch (e) {}
    try { await conn.query(`ALTER TABLE paqueteria_fuentes ADD COLUMN fecha_ingreso DATETIME AFTER codigo_lot`); } catch (e) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS catalogo_cortes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(20) UNIQUE NOT NULL,
        nombre VARCHAR(200) NOT NULL,
        abreviatura VARCHAR(50),
        tipo ENUM('primal','retail','subproducto','grasa','trim','bch','otro') DEFAULT 'primal',
        vida_util_dias INT DEFAULT 90,
        vida_congelado_dias INT DEFAULT 365,
        activo TINYINT DEFAULT 1,
        notas TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_codigo (codigo),
        INDEX idx_nombre (nombre)
      )
    `);

    // Catálogo real CIISA v10 (anexos C1–C4). MySQL 8.0 no soporta ADD COLUMN IF NOT EXISTS:
    // se usa el mismo patrón idempotente del resto del archivo (try/catch ignora "Duplicate column").
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN serie ENUM('F1','FB','PVA','ARREO') NULL AFTER tipo`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN genetica ENUM('F1','FB') NULL AFTER serie`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN codigo_equivalente VARCHAR(20) NULL AFTER genetica`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN unidad ENUM('kg','caja','unidad') DEFAULT 'kg' AFTER codigo_equivalente`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN nombre_en VARCHAR(200) NULL AFTER nombre`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN ventana_min_dias INT NULL AFTER vida_congelado_dias`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN ventana_max_dias INT NULL AFTER ventana_min_dias`); } catch (e) {}
    try { await conn.query(`ALTER TABLE catalogo_cortes ADD COLUMN nota_enlace VARCHAR(200) NULL AFTER ventana_max_dias`); } catch (e) {}
    try { await conn.query(`CREATE INDEX idx_catalogo_serie ON catalogo_cortes (serie)`); } catch (e) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS config_planta (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        marca_comercial VARCHAR(200),
        direccion_linea1 VARCHAR(300),
        direccion_linea2 VARCHAR(300),
        pais VARCHAR(100) DEFAULT 'COSTA RICA',
        numero_mag VARCHAR(50),
        consecutivo_mag INT DEFAULT 0,
        activa TINYINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN numero_mag VARCHAR(50) AFTER lote_sacrificio`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN lote_mag VARCHAR(50) AFTER numero_mag`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN tara_kg DECIMAL(8,3) AFTER lote_mag`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN cuenta INT AFTER tara_kg`); } catch (e) {}
    try { await conn.query(`ALTER TABLE sacrificios ADD COLUMN ruta INT AFTER cuenta`); } catch (e) {}

    try { await conn.query(`ALTER TABLE stickers MODIFY COLUMN codigo_barras VARCHAR(100) NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN codigo_cue VARCHAR(20) AFTER codigo_barras`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN codigo_box VARCHAR(20) AFTER codigo_cue`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN codigo_peso VARCHAR(20) AFTER codigo_box`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN codigo_lot VARCHAR(20) AFTER codigo_peso`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN corte_codigo VARCHAR(20) AFTER tipo_corte`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN fecha_mejor_antes DATE AFTER fecha_empaque`); } catch (e) {}
    try { await conn.query(`ALTER TABLE stickers ADD COLUMN fecha_congelar_hasta DATE AFTER fecha_mejor_antes`); } catch (e) {}
    try { await conn.query(`CREATE INDEX idx_sticker_cue ON stickers (codigo_cue)`); } catch (e) {}
    try { await conn.query(`CREATE INDEX idx_sticker_lot ON stickers (codigo_lot)`); } catch (e) {}
    try { await conn.query(`CREATE INDEX idx_sticker_box ON stickers (codigo_box)`); } catch (e) {}

    const [cortesExist] = await conn.query('SELECT COUNT(*) as c FROM catalogo_cortes');
    if (cortesExist[0].c === 0) {
      await conn.query(`INSERT INTO catalogo_cortes (codigo, nombre, abreviatura, tipo, vida_util_dias, vida_congelado_dias) VALUES
        ('21231','DELMONICO','DELMO','primal',90,365),
        ('21253','RIBEYE STEAK','RIBEY','retail',90,365),
        ('21001','ARRACHERA','ARRA','primal',90,365),
        ('21002','LOMO ENTRANA','LENT','primal',90,365),
        ('21003','DIAFRAGMA','DIAF','primal',90,365),
        ('21004','COSTILLA DE PECHO','CPEC','primal',90,365),
        ('21005','LOMO PALETA','LPAL','primal',90,365),
        ('21006','CACHO DE VUELTA DE LOMO','CVLO','primal',90,365),
        ('21007','GUITARRILLA LIMPIA','GUIT','primal',90,365),
        ('21008','CECINA LIMPIA','CECI','primal',90,365),
        ('21009','CACHO DE PALETA','CPAL','primal',90,365),
        ('21010','CENTRO DE QUITLINENA','CQUI','primal',90,365),
        ('21011','PECHO BRS','PBRS','primal',90,365),
        ('21012','PETTITE FAJITAS','PETT','primal',90,365),
        ('21013','PUNTA DE SOLOMO','PSOL','primal',90,365),
        ('21014','FALDILLA FLS TORTILLA','FLS','primal',90,365),
        ('21015','BOLITA','BOLI','primal',90,365),
        ('21016','MANO DE PIEDRA','MPIE','primal',90,365),
        ('21017','POSTA DE RATON','PRAT','primal',90,365),
        ('21018','POSTA DE SOLOMO','PSOLM','primal',90,365),
        ('21019','TAPA POSTA DE CUARTO GRACILIS','TGRA','primal',90,365),
        ('21020','VUELTA DE LOMO SIN TAPA','VLST','primal',90,365),
        ('21021','LOMITO','LOMT','primal',90,365),
        ('21022','T-BONE Y PORTERHOUSE','TBPO','primal',90,365),
        ('21023','LOMITO CABEZA','LCAB','primal',90,365),
        ('21024','LOMO CHURRASCO','LCHU','primal',90,365),
        ('21025','LOMO CHURRASCO BONE-IN BMS>3','LCBO','primal',90,365),
        ('21026','OSOBUCO','OSOB','primal',90,365),
        ('30001','GRASA RINODADA','GRAS','grasa',60,365),
        ('30002','TRIM EXTRA LIMPIO','TRIM','trim',60,365),
        ('30003','BCH BEEF CHUCK','BCH','bch',60,365)
      `);
    }

    const [plantaExist] = await conn.query('SELECT COUNT(*) as c FROM config_planta WHERE activa = 1');
    if (plantaExist[0].c === 0) {
      await conn.query(`INSERT INTO config_planta (nombre, marca_comercial, direccion_linea1, direccion_linea2, pais, numero_mag) VALUES
        ('CISA COSTA RICA','WAGYU CROSS','EL ARREO 1.5 KM O. FIRESTONE','RIBERA DE BELEN HEREDIA','COSTA RICA','MAG #12')
      `);
    }

    const [bodegasExist] = await conn.query('SELECT COUNT(*) as c FROM bodegas');
    if (bodegasExist[0].c === 0) {
      await conn.query(`INSERT INTO bodegas (codigo, nombre, tipo, temperatura_c) VALUES
        ('BOD-DES', 'Bodega Deshuese', 'deshuese', 4.0),
        ('BOD-CUS', 'Custodia', 'custodia', 2.0),
        ('BOD-MAD', 'Cuarto de Maduracion', 'maduracion', 1.5),
        ('BOD-POR', 'Sala de Porcionado', 'porcionado', 8.0),
        ('BOD-DSP', 'Bodega de Despacho', 'despacho', 2.0)
      `);
    }

    // ── Reporte Diario de Producción (formato CIISA) ─────────────────────────
    // Atajo mínimo hasta el núcleo v10 (docs/nucleo-inventario-v10). Los nombres NO chocan con
    // las tablas de v10 a propósito: `lotes_deshuese` exige `canal_id NOT NULL` (y la tabla
    // `canales` aún no existe) y `etiquetas`/`documentos_ciisa` traen columnas obligatorias que
    // hoy no se capturan. Crearlas a medias haría que el CREATE TABLE IF NOT EXISTS de v10 se
    // saltara en silencio y dejara un esquema distinto al diseñado. El backfill de v10 copia:
    //   reporte_produccion(+_lineas)  → documentos_ciisa tipo 'DESHUESE' (+ _lineas)
    //   lotes_cc_aretes               → lotes_deshuese (fecha_deshuese, numero_lote, arete)
    //   reporte_produccion_escaneos   → etiquetas con origen_etapa = 'deshuese'
    // Todas son aditivas (no tocan tablas existentes) e idempotentes.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reporte_produccion (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha_produccion DATE NOT NULL COMMENT 'Fecha de Producción del reporte CIISA (día del deshuese)',
        lote_cc SMALLINT UNSIGNED NOT NULL COMMENT 'Lote CC = posición del animal en el deshuese del día (06)',
        num_lote VARCHAR(20) NULL COMMENT 'Num. Lote del encabezado CIISA (significado por confirmar, R1)',
        tipo_produccion VARCHAR(60) NULL COMMENT 'Tipo Producción (TEMPISQUE; por confirmar, R2)',
        origen ENUM('excel_csv','manual','pegado','json') NOT NULL DEFAULT 'manual' COMMENT 'Cómo se capturó',
        archivo_nombre VARCHAR(255) NULL COMMENT 'Archivo importado, si vino de Excel/CSV',
        notas VARCHAR(500) NULL,
        cargado_por INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_rp_fecha_lote (fecha_produccion, lote_cc),
        FOREIGN KEY (cargado_por) REFERENCES usuarios(id) ON DELETE SET NULL
      ) COMMENT='Encabezado del Reporte Diario de Producción que declara CIISA (un reporte = un lote CC = un animal)'
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS reporte_produccion_lineas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reporte_id INT NOT NULL,
        linea SMALLINT UNSIGNED NOT NULL COMMENT 'Orden de la fila (por código, como el impreso)',
        articulo_codigo VARCHAR(20) NOT NULL COMMENT 'Código de artículo CIISA (5 dígitos)',
        descripcion VARCHAR(200) NULL COMMENT 'Descripción tal como la trae CIISA',
        peso_kg DECIMAL(10,3) NOT NULL,
        unidad VARCHAR(10) NOT NULL DEFAULT 'KGS',
        cajas INT NOT NULL,
        UNIQUE KEY uk_rpl_articulo (reporte_id, articulo_codigo),
        UNIQUE KEY uk_rpl_linea (reporte_id, linea),
        INDEX idx_rpl_articulo (articulo_codigo),
        FOREIGN KEY (reporte_id) REFERENCES reporte_produccion(id) ON DELETE CASCADE
      ) COMMENT='Filas artículo/peso/cajas del reporte CIISA'
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS lotes_cc_aretes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        fecha_deshuese DATE NOT NULL,
        lote_cc SMALLINT UNSIGNED NOT NULL COMMENT 'Posición en el deshuese del día (n.º impreso en cajas y primales)',
        arete VARCHAR(10) NOT NULL COMMENT 'Arete según la tabla del correo de CIISA',
        animal_id INT NULL COMMENT 'Animal resuelto por numero_trazabilidad = arete (NULL si no está en el registro)',
        deshuese_id INT NULL COMMENT 'Deshuese de la app de ese animal en esa fecha, si existe',
        registrado_por INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_lca_fecha_lote (fecha_deshuese, lote_cc),
        INDEX idx_lca_arete (arete),
        FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE SET NULL,
        FOREIGN KEY (deshuese_id) REFERENCES deshuese(id) ON DELETE SET NULL,
        FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL
      ) COMMENT='Tabla posición → arete por fecha de deshuese (llave para pasar de lote CC a animal)'
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS reporte_produccion_escaneos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo_crudo VARCHAR(64) NOT NULL COMMENT 'Lectura normalizada del escáner',
        copia SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '>1 solo si el operador confirmó que es OTRA caja con la misma etiqueta (misma fecha, lote, artículo y peso)',
        tipo ENUM('caja','primal') NOT NULL,
        articulo_codigo VARCHAR(20) NOT NULL,
        peso_kg DECIMAL(10,3) NOT NULL,
        fecha_deshuese DATE NOT NULL COMMENT 'Fecha del deshuese impresa en la etiqueta',
        lote_cc SMALLINT UNSIGNED NOT NULL COMMENT 'N.º de deshuese impreso en la etiqueta',
        box_codigo VARCHAR(10) NULL,
        sufijo VARCHAR(10) NULL,
        fecha_ambigua TINYINT NOT NULL DEFAULT 0 COMMENT '1 = día ≤ 12, la fecha admite otra lectura',
        decodificado JSON NULL COMMENT 'Resultado completo del decodificador, para auditoría',
        escaneado_por INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_rpe_codigo (codigo_crudo, copia),
        INDEX idx_rpe_fecha_lote (fecha_deshuese, lote_cc),
        INDEX idx_rpe_articulo (articulo_codigo),
        FOREIGN KEY (escaneado_por) REFERENCES usuarios(id) ON DELETE SET NULL
      ) COMMENT='Etiquetas de deshuese (caja/primal) escaneadas en la app: el lado «nuestro» de la conciliación'
    `);

    console.log('Database tables initialized');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
