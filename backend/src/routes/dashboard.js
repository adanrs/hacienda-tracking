const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  try {
    const [[{ total: totalAnimales }]] = await pool.query("SELECT COUNT(*) as total FROM animales WHERE estado = 'activo'");
    const [[{ total: totalPotreros }]] = await pool.query("SELECT COUNT(*) as total FROM potreros WHERE estado = 'activo'");

    const [porSexo] = await pool.query("SELECT sexo, COUNT(*) as total FROM animales WHERE estado = 'activo' GROUP BY sexo");
    const [porRaza] = await pool.query("SELECT raza, COUNT(*) as total FROM animales WHERE estado = 'activo' GROUP BY raza ORDER BY total DESC LIMIT 10");
    const [porPotrero] = await pool.query(`
      SELECT p.nombre, COUNT(a.id) as total
      FROM potreros p LEFT JOIN animales a ON a.potrero_id = p.id AND a.estado = 'activo'
      WHERE p.estado = 'activo' GROUP BY p.id ORDER BY total DESC
    `);

    const [pesajesRecientes] = await pool.query(`
      SELECT p.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM pesajes p JOIN animales a ON p.animal_id = a.id
      ORDER BY p.fecha DESC LIMIT 10
    `);

    const [eventosProximos] = await pool.query(`
      SELECT e.*, a.numero_trazabilidad, a.nombre as animal_nombre
      FROM eventos_salud e JOIN animales a ON e.animal_id = a.id
      WHERE e.proxima_fecha IS NOT NULL AND e.proxima_fecha >= CURDATE()
      ORDER BY e.proxima_fecha ASC LIMIT 10
    `);

    const [gestacionesActivas] = await pool.query(`
      SELECT r.*, h.numero_trazabilidad as hembra_trazabilidad, h.nombre as hembra_nombre
      FROM reproduccion r JOIN animales h ON r.hembra_id = h.id
      WHERE r.resultado = 'gestante'
      ORDER BY r.fecha_parto_estimada ASC
    `);

    const [[{ total: nacimientosMes }]] = await pool.query(`
      SELECT COUNT(*) as total FROM animales
      WHERE fecha_nacimiento >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    `);

    res.json({
      resumen: { totalAnimales, totalPotreros, gestacionesActivas: gestacionesActivas.length, nacimientosMes },
      porSexo, porRaza, porPotrero,
      pesajesRecientes, eventosProximos, gestacionesActivas
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
