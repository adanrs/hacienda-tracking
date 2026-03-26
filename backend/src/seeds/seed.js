const db = require('../models/database');

console.log('Seeding database...');

// Potreros
const potreros = [
  { nombre: 'Potrero Norte', superficie_ha: 15, capacidad_animales: 30 },
  { nombre: 'Potrero Sur', superficie_ha: 20, capacidad_animales: 40 },
  { nombre: 'Potrero Central', superficie_ha: 25, capacidad_animales: 50 },
  { nombre: 'Potrero Río', superficie_ha: 10, capacidad_animales: 20 },
  { nombre: 'Corral Principal', superficie_ha: 2, capacidad_animales: 60 },
];

const insertPotrero = db.prepare('INSERT INTO potreros (nombre, superficie_ha, capacidad_animales) VALUES (?, ?, ?)');
const potrerosIds = potreros.map(p => insertPotrero.run(p.nombre, p.superficie_ha, p.capacidad_animales).lastInsertRowid);

// Animales
const razas = ['Brahman', 'Nelore', 'Gyr', 'Angus', 'Charolais', 'Simmental', 'Hereford'];
const colores = ['Blanco', 'Negro', 'Rojo', 'Pardo', 'Gris', 'Pinto'];

const insertAnimal = db.prepare(`
  INSERT INTO animales (numero_trazabilidad, nombre, tipo, raza, sexo, fecha_nacimiento, peso_nacimiento, color, estado, potrero_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)
`);

const insertPesaje = db.prepare('INSERT INTO pesajes (animal_id, peso_kg, fecha, tipo) VALUES (?, ?, ?, ?)');
const insertSalud = db.prepare('INSERT INTO eventos_salud (animal_id, tipo, fecha, descripcion, producto, veterinario, proxima_fecha) VALUES (?, ?, ?, ?, ?, ?, ?)');

const nombres = ['Luna', 'Estrella', 'Toro Bravo', 'Manchas', 'Canela', 'Relámpago', 'Princesa', 'Guerrero', 'Paloma', 'Ceniza',
  'Brisa', 'Trueno', 'Dulce', 'Capitán', 'Perla', 'Titán', 'Mariposa', 'Diamante', 'Aurora', 'Samurai'];

const seed = db.transaction(() => {
  for (let i = 0; i < 20; i++) {
    const sexo = i < 14 ? 'hembra' : 'macho';
    const raza = razas[i % razas.length];
    const color = colores[i % colores.length];
    const potrero = potrerosIds[i % potrerosIds.length];
    const year = 2020 + (i % 5);
    const month = String((i % 12) + 1).padStart(2, '0');
    const fechaNac = `${year}-${month}-15`;
    const pesoNac = 25 + Math.round(Math.random() * 15);

    const animalId = insertAnimal.run(
      `HT-${String(i + 1).padStart(4, '0')}`,
      nombres[i], 'bovino', raza, sexo, fechaNac, pesoNac, color, potrero
    ).lastInsertRowid;

    // Pesajes
    insertPesaje.run(animalId, pesoNac, fechaNac, 'nacimiento');
    insertPesaje.run(animalId, pesoNac * 3 + Math.round(Math.random() * 20), `${year}-${month === '12' ? '12' : String(Number(month) + 1).padStart(2, '0')}-15`, 'rutinario');
    insertPesaje.run(animalId, 150 + Math.round(Math.random() * 200), '2025-12-01', 'rutinario');

    // Salud
    insertSalud.run(animalId, 'vacunacion', '2025-06-01', 'Vacuna Aftosa', 'Aftogan', 'Dr. Mora', '2026-06-01');
    insertSalud.run(animalId, 'desparasitacion', '2025-09-01', 'Desparasitación interna', 'Ivermectina', 'Dr. Mora', '2026-03-01');
  }
});

seed();
console.log('Seed completed: 5 potreros, 20 animales with pesajes and salud events');
