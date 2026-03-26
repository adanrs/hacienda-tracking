const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const db = require('./models/database');
const { authMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 8001;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Public routes
app.use('/api/auth', require('./routes/auth'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protected routes (require JWT)
app.use('/api/animales', authMiddleware, require('./routes/animales'));
app.use('/api/pesajes', authMiddleware, require('./routes/pesajes'));
app.use('/api/salud', authMiddleware, require('./routes/salud'));
app.use('/api/movimientos', authMiddleware, require('./routes/movimientos'));
app.use('/api/reproduccion', authMiddleware, require('./routes/reproduccion'));
app.use('/api/potreros', authMiddleware, require('./routes/potreros'));
app.use('/api/dashboard', authMiddleware, require('./routes/dashboard'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});
