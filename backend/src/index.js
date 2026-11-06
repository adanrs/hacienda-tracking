const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { initDB } = require('./models/database');
const crypto = require('crypto');
const { authMiddleware, soloLecturaViewer, JWT_SECRET } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(morgan('dev'));
// Integración con la tienda (servicio a servicio, HMAC, sin JWT). Va ANTES de express.json():
// la firma se verifica sobre el cuerpo crudo y el parser global consumiría el stream.
// Rechaza con 404 lo que llegue por Cloudflare (ver middleware/firmaServicio.js).
app.use('/api/integracion/tienda', require('./routes/integracion-tienda'));
// Importador masivo: su propio parser JSON (el texto pegado de un correo puede pasar los 100 kB
// del parser global) y va antes de él para que el global no lo corte con 413.
const protegidaImport = [authMiddleware, soloLecturaViewer];
app.use('/api/importaciones', protegidaImport, express.json({ limit: '3mb' }), require('./routes/importaciones'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Public routes
app.use('/api/auth', require('./routes/auth'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Seed endpoint (protected by secret, for initial setup)
app.post('/api/seed', async (req, res) => {
  const secret = req.headers['x-seed-secret'];
  // Comparación en tiempo constante contra JWT_SECRET (obligatorio: auth.js no arranca sin él).
  const a = Buffer.from(String(secret || ''));
  const b = Buffer.from(JWT_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { runSeed } = require('./seeds/seed');
    await runSeed();
    res.json({ message: 'Seed completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protected routes
// `protegida` = autenticado + viewer en solo lectura (GET sí, POST/PUT/DELETE no).
const protegida = [authMiddleware, soloLecturaViewer];
app.use('/api/animales', protegida, require('./routes/animales'));
app.use('/api/pesajes', protegida, require('./routes/pesajes'));
app.use('/api/salud', protegida, require('./routes/salud'));
app.use('/api/movimientos', protegida, require('./routes/movimientos'));
app.use('/api/reproduccion', protegida, require('./routes/reproduccion'));
app.use('/api/potreros', protegida, require('./routes/potreros'));
app.use('/api/dashboard', protegida, require('./routes/dashboard'));
app.use('/api/transporte', protegida, require('./routes/transporte'));
app.use('/api/guias-transporte', protegida, require('./routes/guias-transporte'));
app.use('/api/sacrificio', protegida, require('./routes/sacrificio'));
app.use('/api/cortes', protegida, require('./routes/cortes'));
app.use('/api/catalogo-cortes', protegida, require('./routes/catalogo-cortes'));
app.use('/api/config-planta', protegida, require('./routes/config-planta'));
app.use('/api/bodegas', protegida, require('./routes/bodegas'));
app.use('/api/deshuese', protegida, require('./routes/deshuese'));
app.use('/api/primales', protegida, require('./routes/primales'));
app.use('/api/custodia', protegida, require('./routes/custodia'));
app.use('/api/maduracion', protegida, require('./routes/maduracion'));
app.use('/api/porcionado', protegida, require('./routes/porcionado'));
app.use('/api/cajas', protegida, require('./routes/cajas'));
app.use('/api/stickers', protegida, require('./routes/stickers'));
app.use('/api/ordenes-salida', protegida, require('./routes/ordenes-salida'));
app.use('/api/ordenes-entrada', protegida, require('./routes/ordenes-entrada'));
app.use('/api/devoluciones', protegida, require('./routes/devoluciones'));
app.use('/api/paqueteria', protegida, require('./routes/paqueteria'));
app.use('/api/alertas-bms', protegida, require('./routes/alertas-bms'));
app.use('/api/temperaturas-bodega', protegida, require('./routes/temperaturas-bodega'));
app.use('/api/reporte-produccion', protegida, require('./routes/reporte-produccion'));
app.use('/api/solicitudes-deshuese', protegida, require('./routes/solicitudes-deshuese'));
// Etiquetas solo expone POST /decodificar, que es cálculo puro (no escribe en la base):
// el viewer lo puede usar para consultar una etiqueta escaneada.
app.use('/api/etiquetas', authMiddleware, require('./routes/etiquetas'));

// Start with DB init
async function start() {
  try {
    await initDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start:', err.message);
    // Retry after 5s (wait for MySQL to be ready)
    setTimeout(start, 5000);
  }
}

start();
