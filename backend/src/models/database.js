const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, 'hacienda.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS potreros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    superficie_ha REAL,
    capacidad_animales INTEGER,
    estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo','inactivo','mantenimiento')),
    ubicacion_gps TEXT,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS animales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero_trazabilidad TEXT UNIQUE NOT NULL,
    nombre TEXT,
    tipo TEXT NOT NULL CHECK(tipo IN ('bovino','equino','bufalino')),
    raza TEXT,
    sexo TEXT NOT NULL CHECK(sexo IN ('macho','hembra')),
    fecha_nacimiento DATE,
    peso_nacimiento REAL,
    color TEXT,
    marca_hierro TEXT,
    estado TEXT DEFAULT 'activo' CHECK(estado IN ('activo','vendido','muerto','trasladado')),
    madre_id INTEGER REFERENCES animales(id),
    padre_id INTEGER REFERENCES animales(id),
    potrero_id INTEGER REFERENCES potreros(id),
    peso_actual REAL,
    foto_url TEXT,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pesajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL REFERENCES animales(id) ON DELETE CASCADE,
    peso_kg REAL NOT NULL,
    fecha DATE NOT NULL,
    tipo TEXT DEFAULT 'rutinario' CHECK(tipo IN ('rutinario','nacimiento','destete','venta','entrada')),
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS eventos_salud (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL REFERENCES animales(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK(tipo IN ('vacunacion','desparasitacion','tratamiento','cirugia','examen','otro')),
    fecha DATE NOT NULL,
    descripcion TEXT NOT NULL,
    producto TEXT,
    dosis TEXT,
    veterinario TEXT,
    costo REAL DEFAULT 0,
    proxima_fecha DATE,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    animal_id INTEGER NOT NULL REFERENCES animales(id) ON DELETE CASCADE,
    potrero_origen_id INTEGER REFERENCES potreros(id),
    potrero_destino_id INTEGER REFERENCES potreros(id),
    fecha DATE NOT NULL,
    motivo TEXT,
    responsable TEXT,
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reproduccion (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hembra_id INTEGER NOT NULL REFERENCES animales(id) ON DELETE CASCADE,
    macho_id INTEGER REFERENCES animales(id),
    tipo TEXT NOT NULL CHECK(tipo IN ('monta_natural','inseminacion_artificial','transferencia_embrion')),
    fecha_servicio DATE NOT NULL,
    fecha_parto_estimada DATE,
    fecha_parto_real DATE,
    cria_id INTEGER REFERENCES animales(id),
    resultado TEXT CHECK(resultado IN ('gestante','vacia','aborto','parto_exitoso','parto_complicado',NULL)),
    notas TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    nombre TEXT NOT NULL,
    email TEXT,
    rol TEXT DEFAULT 'operador' CHECK(rol IN ('admin','operador','viewer')),
    activo INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);
  CREATE INDEX IF NOT EXISTS idx_animales_trazabilidad ON animales(numero_trazabilidad);
  CREATE INDEX IF NOT EXISTS idx_animales_potrero ON animales(potrero_id);
  CREATE INDEX IF NOT EXISTS idx_pesajes_animal ON pesajes(animal_id);
  CREATE INDEX IF NOT EXISTS idx_salud_animal ON eventos_salud(animal_id);
  CREATE INDEX IF NOT EXISTS idx_movimientos_animal ON movimientos(animal_id);
  CREATE INDEX IF NOT EXISTS idx_reproduccion_hembra ON reproduccion(hembra_id);
`);

module.exports = db;
