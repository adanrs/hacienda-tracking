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

    console.log('Database tables initialized');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
