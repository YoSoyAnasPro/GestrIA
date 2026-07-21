const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET;
if (!SECRET) { console.error('[FATAL] JWT_SECRET environment variable is required'); process.exit(1); }

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role || 'admin';
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { auth, SECRET };
