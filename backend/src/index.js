const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const db = require('./models/database');

const app = express();
const PORT = process.env.PORT || 8001;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/animales', require('./routes/animales'));
app.use('/api/pesajes', require('./routes/pesajes'));
app.use('/api/salud', require('./routes/salud'));
app.use('/api/movimientos', require('./routes/movimientos'));
app.use('/api/reproduccion', require('./routes/reproduccion'));
app.use('/api/potreros', require('./routes/potreros'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});
