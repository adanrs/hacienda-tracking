const bcrypt = require('bcryptjs');
const { pool, initDB } = require('../models/database');

async function runSeed() {
  await initDB();

  // Check if already seeded
  const [admins] = await pool.query('SELECT id FROM usuarios WHERE username = ?', ['admin.tempisque']);
  if (!admins.length) {
    const adminPwd = process.env.ADMIN_PASSWORD || 'HT$2026!Adm1n#Tmp';
    const operPwd = process.env.OPER_PASSWORD || 'HT$2026!0per#Tmp';
    await pool.query('INSERT INTO usuarios (username, password, nombre, email, rol) VALUES (?, ?, ?, ?, ?)',
      ['admin.tempisque', bcrypt.hashSync(adminPwd, 12), 'Administrador', 'admin@haciendatempisque.com', 'admin']);
    await pool.query('INSERT INTO usuarios (username, password, nombre, email, rol) VALUES (?, ?, ?, ?, ?)',
      ['operador.campo', bcrypt.hashSync(operPwd, 12), 'Operador Campo', 'operador@haciendatempisque.com', 'operador']);
    console.log('Users created: admin.tempisque / operador.campo');
  }

  const [existingPotreros] = await pool.query('SELECT id FROM potreros LIMIT 1');
  if (existingPotreros.length) { console.log('Data already seeded, skipping...'); return; }

  // Potreros
  const potreros = [
    ['Potrero Norte', 15, 30], ['Potrero Sur', 20, 40], ['Potrero Central', 25, 50],
    ['Potrero Río', 10, 20], ['Corral Principal', 2, 60],
  ];
  const potrerosIds = [];
  for (const [nombre, sup, cap] of potreros) {
    const [r] = await pool.query('INSERT INTO potreros (nombre, superficie_ha, capacidad_animales) VALUES (?, ?, ?)', [nombre, sup, cap]);
    potrerosIds.push(r.insertId);
  }

  // Animales
  const razas = ['Brahman', 'Nelore', 'Gyr', 'Angus', 'Charolais', 'Simmental', 'Hereford'];
  const colores = ['Blanco', 'Negro', 'Rojo', 'Pardo', 'Gris', 'Pinto'];
  const nombres = ['Luna', 'Estrella', 'Toro Bravo', 'Manchas', 'Canela', 'Relámpago', 'Princesa', 'Guerrero', 'Paloma', 'Ceniza',
    'Brisa', 'Trueno', 'Dulce', 'Capitán', 'Perla', 'Titán', 'Mariposa', 'Diamante', 'Aurora', 'Samurai'];

  for (let i = 0; i < 20; i++) {
    const sexo = i < 14 ? 'hembra' : 'macho';
    const raza = razas[i % razas.length];
    const color = colores[i % colores.length];
    const potrero = potrerosIds[i % potrerosIds.length];
    const year = 2020 + (i % 5);
    const month = String((i % 12) + 1).padStart(2, '0');
    const fechaNac = `${year}-${month}-15`;
    const pesoNac = 25 + Math.round(Math.random() * 15);
    const pesoActual = 150 + Math.round(Math.random() * 200);

    const [r] = await pool.query(`
      INSERT INTO animales (numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, peso_actual, color, estado, potrero_id)
      VALUES (?, ?, 'bovino', ?, ?, ?, ?, ?, ?, 'activo', ?)
    `, [`HT-${String(i + 1).padStart(4, '0')}`, nombres[i], raza, sexo, fechaNac, pesoNac, pesoActual, color, potrero]);
    const animalId = r.insertId;

    const nextMonth = month === '12' ? '12' : String(Number(month) + 1).padStart(2, '0');
    await pool.query('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo) VALUES (?, ?, ?, ?)', [animalId, pesoNac, fechaNac, 'nacimiento']);
    await pool.query('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo) VALUES (?, ?, ?, ?)', [animalId, pesoNac * 3 + Math.round(Math.random() * 20), `${year}-${nextMonth}-15`, 'rutinario']);
    await pool.query('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo) VALUES (?, ?, ?, ?)', [animalId, pesoActual, '2025-12-01', 'rutinario']);

    await pool.query('INSERT INTO eventos_salud (animal_id, tipo, fecha, descripcion, producto, veterinario, proxima_fecha) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [animalId, 'vacunacion', '2025-06-01', 'Vacuna Aftosa', 'Aftogan', 'Dr. Mora', '2026-06-01']);
    await pool.query('INSERT INTO eventos_salud (animal_id, tipo, fecha, descripcion, producto, veterinario, proxima_fecha) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [animalId, 'desparasitacion', '2025-09-01', 'Desparasitación interna', 'Ivermectina', 'Dr. Mora', '2026-03-01']);
  }

  console.log('Seed completed: 2 users, 5 potreros, 20 animales with pesajes and salud events');
}

// Run directly or export
if (require.main === module) {
  runSeed().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runSeed };
