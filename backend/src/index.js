const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const { initDB } = require('./models/database');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(morgan('dev'));
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
  if (secret !== (process.env.JWT_SECRET || 'dev-seed')) {
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
app.use('/api/animales', authMiddleware, require('./routes/animales'));
app.use('/api/pesajes', authMiddleware, require('./routes/pesajes'));
app.use('/api/salud', authMiddleware, require('./routes/salud'));
app.use('/api/movimientos', authMiddleware, require('./routes/movimientos'));
app.use('/api/reproduccion', authMiddleware, require('./routes/reproduccion'));
app.use('/api/potreros', authMiddleware, require('./routes/potreros'));
app.use('/api/dashboard', authMiddleware, require('./routes/dashboard'));
app.use('/api/transporte', authMiddleware, require('./routes/transporte'));
app.use('/api/sacrificio', authMiddleware, require('./routes/sacrificio'));
app.use('/api/cortes', authMiddleware, require('./routes/cortes'));
app.use('/api/catalogo-cortes', authMiddleware, require('./routes/catalogo-cortes'));
app.use('/api/config-planta', authMiddleware, require('./routes/config-planta'));
app.use('/api/bodegas', authMiddleware, require('./routes/bodegas'));
app.use('/api/deshuese', authMiddleware, require('./routes/deshuese'));
app.use('/api/primales', authMiddleware, require('./routes/primales'));
app.use('/api/custodia', authMiddleware, require('./routes/custodia'));
app.use('/api/maduracion', authMiddleware, require('./routes/maduracion'));
app.use('/api/porcionado', authMiddleware, require('./routes/porcionado'));
app.use('/api/cajas', authMiddleware, require('./routes/cajas'));
app.use('/api/stickers', authMiddleware, require('./routes/stickers'));
app.use('/api/ordenes-salida', authMiddleware, require('./routes/ordenes-salida'));
app.use('/api/ordenes-entrada', authMiddleware, require('./routes/ordenes-entrada'));
app.use('/api/devoluciones', authMiddleware, require('./routes/devoluciones'));
app.use('/api/paqueteria', authMiddleware, require('./routes/paqueteria'));

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
