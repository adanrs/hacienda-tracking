const router = require('express').Router();
const { decodificar } = require('../lib/etiquetas');
const { pool } = require('../models/database');
const { compararConEtiqueta } = require('../lib/importador/procesadores/marmoleoCamara');
const { recuperarPorReporte } = require('../lib/trazabilidadEtiqueta');
const { marmoleosDe, marmoleoDeLinea } = require('../lib/bmsCaja');

// POST /api/etiquetas/decodificar  { codigo } → resultado de decodificar.
// El decodificador es cálculo puro; aquí solo se agrega una LECTURA: si la etiqueta trae arete y
// marmoleo, se compara con el marmoleo AUS-MEAT medido en la canal de ese animal (pantalla
// Marmoleo) y se avisa si difieren. Una caja no trae BMS (sus 2 últimos dígitos son un sufijo): si
// su lote traza a un animal, se devuelve el marmoleo de ese animal como su BMS. Si la consulta
// falla, la decodificación igual se devuelve.
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
  // Caja o primal con «xxx» (trazabilidad perdida): se intenta recuperar el animal por el puente
  // fecha + lote de deshuese → reporte de producción con arete (ver lib/trazabilidadEtiqueta.js).
  // El arete deducido se muestra como «recuperada», nunca como si viniera impreso.
  if (c && c.trazabilidad === 'sin_trazabilidad' && (r.tipo === 'caja' || r.tipo === 'primal')) {
    try {
      const t = await recuperarPorReporte(pool, r);
      r.trazabilidad = t;
      if (t.estado === 'recuperada' && Array.isArray(r.advertencias)) {
        r.advertencias.push({ codigo: 'trazabilidad_recuperada', campo: 'loteDeshuese', mensaje: t.motivo });
      }
    } catch (err) {
      console.error('[etiquetas] recuperación de trazabilidad', err.message);
    }
  } else if (c && c.trazabilidad) {
    r.trazabilidad = { estado: c.trazabilidad };
  }
  // Caja: los 2 últimos dígitos son un sufijo, NO el BMS (Juan Carlos, 07-nov-2026). Su BMS es el
  // marmoleo medido del animal al que traza el lote (fecha de deshuese + Lote CC); sin eso, null.
  if (c && r.tipo === 'caja') {
    try {
      const t = r.trazabilidad && r.trazabilidad.animal_id ? r.trazabilidad : await recuperarPorReporte(pool, r);
      if (t && t.estado === 'recuperada') {
        const m = await marmoleosDe(pool, { animalIds: [t.animal_id], aretes: [t.arete] });
        const bms = marmoleoDeLinea(m, t);
        r.bms_animal = { arete: t.arete, bms };
      }
    } catch (err) {
      console.error('[etiquetas] marmoleo del animal de la caja', err.message);
    }
  }
  res.json(r);
});

module.exports = router;
