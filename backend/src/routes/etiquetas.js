const router = require('express').Router();
const { decodificar } = require('../lib/etiquetas');

// POST /api/etiquetas/decodificar  { codigo } → resultado de decodificar (sin tocar base de datos)
router.post('/decodificar', (req, res) => {
  const codigo = req.body ? req.body.codigo : undefined;
  if (typeof codigo !== 'string' || !codigo.trim()) {
    return res.status(400).json({ error: 'Se requiere «codigo» (texto leído de la etiqueta)' });
  }
  if (codigo.length > 200) {
    return res.status(400).json({ error: 'Código demasiado largo' });
  }
  res.json(decodificar(codigo));
});

module.exports = router;
