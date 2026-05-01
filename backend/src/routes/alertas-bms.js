const router = require('express').Router();
const { pool } = require('../models/database');

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.animal_id, s.fecha, s.marmoleo, s.tipo_pasaje, s.lote_sacrificio,
        a.numero_trazabilidad, a.nombre as animal_nombre,
        CASE s.tipo_pasaje
          WHEN 'F1' THEN 3 WHEN 'F2' THEN 5 WHEN 'F3' THEN 7 WHEN 'F4' THEN 7 WHEN 'F8' THEN 8
          ELSE NULL END AS threshold
      FROM sacrificios s
      JOIN animales a ON s.animal_id = a.id
      WHERE s.marmoleo IS NOT NULL
        AND s.tipo_pasaje IN ('F1','F2','F3','F4','F8')
        AND s.marmoleo < CASE s.tipo_pasaje
          WHEN 'F1' THEN 3 WHEN 'F2' THEN 5 WHEN 'F3' THEN 7 WHEN 'F4' THEN 7 WHEN 'F8' THEN 8
        END
      ORDER BY s.fecha DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
