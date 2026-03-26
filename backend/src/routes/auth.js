const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../models/database');
const { JWT_SECRET, authMiddleware, requireRole } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username y password son requeridos' });

  try {
    const [users] = await pool.query('SELECT * FROM usuarios WHERE username = ? AND activo = 1', [username]);
    if (!users.length) return res.status(401).json({ error: 'Credenciales invalidas' });
    const user = users[0];

    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Credenciales invalidas' });

    const token = jwt.sign({ id: user.id, username: user.username, nombre: user.nombre, rol: user.rol }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username, nombre: user.nombre, email: user.email, rol: user.rol } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query('SELECT id, username, nombre, email, rol, created_at FROM usuarios WHERE id = ?', [req.user.id]);
    if (!users.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(users[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Passwords requeridos' });
  if (new_password.length < 6) return res.status(400).json({ error: 'La nueva password debe tener al menos 6 caracteres' });

  try {
    const [users] = await pool.query('SELECT * FROM usuarios WHERE id = ?', [req.user.id]);
    if (!bcrypt.compareSync(current_password, users[0].password)) return res.status(401).json({ error: 'Password actual incorrecta' });
    const hash = bcrypt.hashSync(new_password, 12);
    await pool.query('UPDATE usuarios SET password = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Password actualizada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/usuarios', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, username, nombre, email, rol, activo, created_at FROM usuarios ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios', authMiddleware, requireRole('admin'), async (req, res) => {
  const { username, password, nombre, email, rol } = req.body;
  if (!username || !password || !nombre) return res.status(400).json({ error: 'username, password y nombre son requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'La password debe tener al menos 6 caracteres' });
  try {
    const hash = bcrypt.hashSync(password, 12);
    const [result] = await pool.query('INSERT INTO usuarios (username, password, nombre, email, rol) VALUES (?, ?, ?, ?, ?)', [username, hash, nombre, email, rol || 'operador']);
    const [rows] = await pool.query('SELECT id, username, nombre, email, rol, activo, created_at FROM usuarios WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El username ya existe' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/usuarios/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { nombre, email, rol, activo, password } = req.body;
  const updates = []; const values = [];
  if (nombre !== undefined) { updates.push('nombre = ?'); values.push(nombre); }
  if (email !== undefined) { updates.push('email = ?'); values.push(email); }
  if (rol !== undefined) { updates.push('rol = ?'); values.push(rol); }
  if (activo !== undefined) { updates.push('activo = ?'); values.push(activo ? 1 : 0); }
  if (password) { updates.push('password = ?'); values.push(bcrypt.hashSync(password, 12)); }
  if (!updates.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
  try {
    await pool.query(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, [...values, req.params.id]);
    const [rows] = await pool.query('SELECT id, username, nombre, email, rol, activo, created_at FROM usuarios WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/usuarios/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  try {
    const [result] = await pool.query('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
