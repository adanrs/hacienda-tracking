const router = require('express').Router();
const { decodificar } = require('../lib/etiquetas');
const { pool } = require('../models/database');
const { compararConEtiqueta } = require('../lib/importador/procesadores/marmoleoCamara');

// POST /api/etiquetas/decodificar  { codigo } → resultado de decodificar.
// El decodificador es cálculo puro; aquí solo se agrega una LECTURA: si la etiqueta trae arete y
// marmoleo, se compara con el marmoleo AUS-MEAT medido en la canal de ese animal (pantalla
// Marmoleo) y se avisa si difieren. Si la consulta falla, la decodificación igual se devuelve.
router.post('/decodificar', async (req, res) => {
  const codigo = req.body ? req.body.codigo : undefined;
  if (typeof codigo !== 'string' || !codigo.trim()) {
    return res.status(400).json({ error: 'Se requiere «codigo» (texto leído de la etiqueta)' });
  }
  if (codigo.length > 200) {
    return res.status(400).json({ error: 'Código demasiado largo' });
  }
  const r = decodificar(codigo);
  const c = r && r.campos;
  if (c && c.arete && c.marmoleo != null) {
    try {
      const aretes = [...new Set([c.arete, c.areteSinRelleno].filter(Boolean))];
      const [filas] = await pool.query(
        `SELECT s.marmoleo, a.numero_trazabilidad FROM sacrificios s JOIN animales a ON a.id = s.animal_id
         WHERE a.numero_trazabilidad IN (?) AND s.marmoleo IS NOT NULL LIMIT 1`, [aretes]);
      if (filas.length) {
        const comp = compararConEtiqueta(Number(filas[0].marmoleo), Number(c.marmoleo));
        r.marmoleo_canal = { arete: filas[0].numero_trazabilidad, ausmeat: Number(filas[0].marmoleo), ...comp };
        if (comp.aviso && Array.isArray(r.advertencias)) {
          r.advertencias.push({ codigo: 'marmoleo_distinto', campo: 'marmoleo', mensaje: comp.aviso });
        }
      }
    } catch (err) {
      console.error('[etiquetas] comparación de marmoleo', err.message);
    }
  }
  res.json(r);
});

module.exports = router;
