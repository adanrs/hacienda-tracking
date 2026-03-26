const router = require('express').Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const totalAnimales = db.prepare("SELECT COUNT(*) as total FROM animales WHERE estado = 'activo'").get().total;
  const totalPotreros = db.prepare("SELECT COUNT(*) as total FROM potreros WHERE estado = 'activo'").get().total;

  const porSexo = db.prepare("SELECT sexo, COUNT(*) as total FROM animales WHERE estado = 'activo' GROUP BY sexo").all();
  const porRaza = db.prepare("SELECT raza, COUNT(*) as total FROM animales WHERE estado = 'activo' GROUP BY raza ORDER BY total DESC LIMIT 10").all();
  const porPotrero = db.prepare(`
    SELECT p.nombre, COUNT(a.id) as total
    FROM potreros p LEFT JOIN animales a ON a.potrero_id = p.id AND a.estado = 'activo'
    WHERE p.estado = 'activo' GROUP BY p.id ORDER BY total DESC
  `).all();

  const pesajesRecientes = db.prepare(`
    SELECT p.*, a.numero_trazabilidad, a.nombre as animal_nombre
    FROM pesajes p JOIN animales a ON p.animal_id = a.id
    ORDER BY p.fecha DESC LIMIT 10
  `).all();

  const eventosProximos = db.prepare(`
    SELECT e.*, a.numero_trazabilidad, a.nombre as animal_nombre
    FROM eventos_salud e JOIN animales a ON e.animal_id = a.id
    WHERE e.proxima_fecha IS NOT NULL AND e.proxima_fecha >= date('now')
    ORDER BY e.proxima_fecha ASC LIMIT 10
  `).all();

  const gestacionesActivas = db.prepare(`
    SELECT r.*, h.numero_trazabilidad as hembra_trazabilidad, h.nombre as hembra_nombre
    FROM reproduccion r JOIN animales h ON r.hembra_id = h.id
    WHERE r.resultado = 'gestante'
    ORDER BY r.fecha_parto_estimada ASC
  `).all();

  const nacimientosMes = db.prepare(`
    SELECT COUNT(*) as total FROM animales
    WHERE fecha_nacimiento >= date('now', 'start of month')
  `).get().total;

  res.json({
    resumen: { totalAnimales, totalPotreros, gestacionesActivas: gestacionesActivas.length, nacimientosMes },
    porSexo, porRaza, porPotrero,
    pesajesRecientes, eventosProximos, gestacionesActivas
  });
});

module.exports = router;
