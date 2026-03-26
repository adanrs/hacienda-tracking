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

  // Transporte samples (animals 1 and 2)
  const [animalesSeed] = await pool.query('SELECT id FROM animales ORDER BY id ASC LIMIT 3');
  if (animalesSeed.length >= 3) {
    const a1 = animalesSeed[0].id;
    const a2 = animalesSeed[1].id;
    const a3 = animalesSeed[2].id;

    await pool.query(`
      INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, fecha_llegada, transportista, placa_vehiculo, guia_movilizacion, estado, notas)
      VALUES (?, 'finca', 'Finca El Roble', '2025-10-01 08:00:00', '2025-10-01 12:00:00', 'Juan Perez', 'ABC-123', 'GM-2025-0001', 'recibido', 'Traslado rutinario')
    `, [a1]);
    await pool.query(`
      INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, fecha_llegada, transportista, placa_vehiculo, guia_movilizacion, estado, notas)
      VALUES (?, 'matadero', 'Matadero Central', '2025-11-15 06:00:00', '2025-11-15 09:00:00', 'Carlos Rios', 'XYZ-789', 'GM-2025-0045', 'recibido', 'Transporte a sacrificio')
    `, [a3]);
    await pool.query(`
      INSERT INTO transporte (animal_id, tipo, destino, fecha_salida, transportista, placa_vehiculo, guia_movilizacion, estado)
      VALUES (?, 'feria', 'Feria Ganadera Regional', '2026-04-10 07:00:00', 'Miguel Torres', 'DEF-456', 'GM-2026-0012', 'programado')
    `, [a2]);

    // Sacrificio sample (animal 3)
    const pesoVivo = 450;
    const pesoCanalCaliente = 260;
    const pesoCanalFrio = 248;
    const rendimiento = parseFloat(((pesoCanalFrio / pesoVivo) * 100).toFixed(2));
    const [sacResult] = await pool.query(`
      INSERT INTO sacrificios (animal_id, fecha, peso_vivo, peso_canal_caliente, peso_canal_frio, rendimiento_canal, inspector, resultado_inspeccion, lote_sacrificio, notas)
      VALUES (?, '2025-11-15 10:00:00', ?, ?, ?, ?, 'Dr. Vargas', 'aprobado', 'LS-2025-011', 'Sacrificio programado')
    `, [a3, pesoVivo, pesoCanalCaliente, pesoCanalFrio, rendimiento]);
    await pool.query("UPDATE animales SET estado = 'sacrificado' WHERE id = ?", [a3]);

    // Cortes samples for the sacrificio
    const sacId = sacResult.insertId;
    await pool.query(`INSERT INTO cortes (sacrificio_id, animal_id, tipo_corte, peso_kg, calidad, destino, lote_empaque, fecha_empaque) VALUES (?, ?, 'lomo', 18.5, 'exportacion', 'Exportadora del Sur', 'EP-2025-100', '2025-11-16')`, [sacId, a3]);
    await pool.query(`INSERT INTO cortes (sacrificio_id, animal_id, tipo_corte, peso_kg, calidad, destino, lote_empaque, fecha_empaque) VALUES (?, ?, 'costilla', 32.0, 'primera', 'Supermercado Central', 'EP-2025-101', '2025-11-16')`, [sacId, a3]);
    await pool.query(`INSERT INTO cortes (sacrificio_id, animal_id, tipo_corte, peso_kg, calidad, destino, lote_empaque, fecha_empaque) VALUES (?, ?, 'pierna', 45.2, 'primera', 'Distribuidora Norte', 'EP-2025-102', '2025-11-16')`, [sacId, a3]);
  }

  console.log('Seed completed: 2 users, 5 potreros, 20 animales with pesajes, salud events, transporte, sacrificio and cortes');
}

// Run directly or export
if (require.main === module) {
  runSeed().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { runSeed };
