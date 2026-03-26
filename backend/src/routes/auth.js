const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../models/database');
const { JWT_SECRET, authMiddleware, requireRole } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username y password son requeridos' });
  }

  const user = db.prepare('SELECT * FROM usuarios WHERE username = ? AND activo = 1').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciales invalidas' });

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, nombre: user.nombre, email: user.email, rol: user.rol }
  });
});

// GET /api/auth/me - get current user info
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, nombre, email, rol, created_at FROM usuarios WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(user);
});

// PUT /api/auth/password - change own password
router.put('/password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Passwords requeridos' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'La nueva password debe tener al menos 6 caracteres' });
  }

  const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password)) {
    return res.status(401).json({ error: 'Password actual incorrecta' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE usuarios SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, req.user.id);
  res.json({ message: 'Password actualizada' });
});

// === Admin routes for user management ===

// GET /api/auth/usuarios - list all users (admin only)
router.get('/usuarios', authMiddleware, requireRole('admin'), (req, res) => {
  const usuarios = db.prepare('SELECT id, username, nombre, email, rol, activo, created_at FROM usuarios ORDER BY created_at DESC').all();
  res.json(usuarios);
});

// POST /api/auth/usuarios - create user (admin only)
router.post('/usuarios', authMiddleware, requireRole('admin'), (req, res) => {
  const { username, password, nombre, email, rol } = req.body;
  if (!username || !password || !nombre) {
    return res.status(400).json({ error: 'username, password y nombre son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La password debe tener al menos 6 caracteres' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO usuarios (username, password, nombre, email, rol) VALUES (?, ?, ?, ?, ?)')
      .run(username, hash, nombre, email, rol || 'operador');
    const user = db.prepare('SELECT id, username, nombre, email, rol, activo, created_at FROM usuarios WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'El username ya existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/usuarios/:id - update user (admin only)
router.put('/usuarios/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const { nombre, email, rol, activo, password } = req.body;
  const updates = [];
  const values = [];

  if (nombre !== undefined) { updates.push('nombre = ?'); values.push(nombre); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email); }
  if (rol !== undefined) { updates.push('rol = ?'); values.push(rol); }
  if (activo !== undefined) { updates.push('activo = ?'); values.push(activo ? 1 : 0); }
  if (password) {
    updates.push('password = ?');
    values.push(bcrypt.hashSync(password, 10));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  db.prepare(`UPDATE usuarios SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, req.params.id);
  const user = db.prepare('SELECT id, username, nombre, email, rol, activo, created_at FROM usuarios WHERE id = ?').get(req.params.id);
  res.json(user);
});

// DELETE /api/auth/usuarios/:id - delete user (admin only)
router.delete('/usuarios/:id', authMiddleware, requireRole('admin'), (req, res) => {
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  }
  const result = db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ message: 'Usuario eliminado' });
});

module.exports = router;
