const jwt = require('jsonwebtoken');

// Sin valor por omisión: con el valor fijo que había, cualquiera que leyera el repo podía firmar
// un token de admin si en el servidor faltaba la variable. Mejor no arrancar que arrancar abierto.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || !JWT_SECRET.trim()) {
  throw new Error('JWT_SECRET no está definido: el backend no arranca sin él (definirlo en el .env / compose del servidor)');
}
if (JWT_SECRET.length < 32) {
  console.warn('[auth] JWT_SECRET tiene menos de 32 caracteres: conviene uno más largo (p. ej. `openssl rand -hex 32`)');
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticacion requerido' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido o expirado' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permisos para esta accion' });
    }
    next();
  };
}

// Roles que pueden escribir. El rol `viewer` es "Solo lectura" (así lo muestra el frontend
// en App.jsx), pero hasta ahora solo lo ocultaba la interfaz: la API le aceptaba POST/PUT/
// DELETE. Se usa lista de roles que SÍ escriben (no de los que no) para que un rol nuevo o
// desconocido quede en solo lectura por defecto.
// El rol `servicio` (usuario técnico de la integración con la tienda) tampoco está: no inicia
// sesión y sus escrituras van solo por /api/integracion con firma HMAC.
const ROLES_ESCRITURA = new Set(['admin', 'operador']);
const METODOS_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

function soloLecturaViewer(req, res, next) {
  if (METODOS_LECTURA.has(req.method)) return next();
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  if (!ROLES_ESCRITURA.has(req.user.rol)) {
    return res.status(403).json({ error: 'Tu usuario es de solo lectura' });
  }
  next();
}

module.exports = { authMiddleware, requireRole, soloLecturaViewer, JWT_SECRET };
