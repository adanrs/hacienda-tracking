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

    const [topGDP] = await pool.query(`
      SELECT a.id, a.numero_trazabilidad, a.nombre,
        a.peso_nacimiento, a.peso_actual,
        DATEDIFF(CURDATE(), a.fecha_nacimiento) as dias_vida,
        CASE WHEN DATEDIFF(CURDATE(), a.fecha_nacimiento) > 0
          THEN ROUND((a.peso_actual - a.peso_nacimiento) / DATEDIFF(CURDATE(), a.fecha_nacimiento), 3)
          ELSE 0 END as gdp
      FROM animales a
      WHERE a.estado = 'activo' AND a.peso_actual IS NOT NULL AND a.fecha_nacimiento IS NOT NULL
      ORDER BY gdp DESC LIMIT 20
    `);

    const [[{ total: primalesEnCustodia }]] = await pool.query("SELECT COUNT(*) as total FROM primales WHERE estado IN ('en_custodia','en_maduracion')");
    const [[{ total: deshueseAbiertos }]] = await pool.query("SELECT COUNT(*) as total FROM deshuese WHERE estado = 'abierto'");
    const [[{ total: ordenesPendientes }]] = await pool.query("SELECT COUNT(*) as total FROM ordenes_salida WHERE estado IN ('pendiente','en_preparacion')");
    const [[{ total: devolucionesSinReprocesar }]] = await pool.query("SELECT COUNT(*) as total FROM devoluciones WHERE reprocesado = 0");

    const [maduracionAlertas] = await pool.query(`
      SELECT p.id, p.codigo, p.tipo_primal, p.marmoleo, p.fecha_maduracion_inicio,
        DATEDIFF(NOW(), p.fecha_maduracion_inicio) as dias_maduracion,
        a.numero_trazabilidad,
        CASE
          WHEN DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 30 THEN 'vencido'
          WHEN DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 28 THEN 'urgente'
          WHEN DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 21 THEN 'proximo'
          ELSE 'normal'
        END as nivel
      FROM primales p
      JOIN animales a ON p.animal_id = a.id
      WHERE p.estado = 'en_maduracion' AND p.fecha_maduracion_inicio IS NOT NULL
        AND DATEDIFF(NOW(), p.fecha_maduracion_inicio) >= 21
      ORDER BY dias_maduracion DESC
      LIMIT 20
    `);

    res.json({
      resumen: {
        totalAnimales, totalPotreros, gestacionesActivas: gestacionesActivas.length, nacimientosMes,
        primalesEnCustodia, deshueseAbiertos, ordenesPendientes, devolucionesSinReprocesar,
        maduracionAlertasCount: maduracionAlertas.length
      },
      porSexo, porRaza, porPotrero,
      pesajesRecientes, eventosProximos, gestacionesActivas, topGDP,
      maduracionAlertas
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
