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

    console.log('Database tables initialized');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
