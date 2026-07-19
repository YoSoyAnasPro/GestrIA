const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createUser, getUserByEmail, getUserById, getDb } = require('../database');
const { auth, SECRET } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  const { name, email, password, business_name } = req.body;
  try {
    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'Email ya registrado' });
    const user = await createUser(name, email, password, business_name, 'admin');
    const token = jwt.sign({ userId: user.id, role: 'admin' }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, business_name: user.business_name, role: 'admin' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await getUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const role = user.role || 'admin';
    const token = jwt.sign({ userId: user.id, role }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, business_name: user.business_name, role } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ id: user.id, name: user.name, email: user.email, business_name: user.business_name, role: user.role || 'admin', logo: user.logo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/create-user', auth, async (req, res) => {
  try {
    const caller = await getUserById(req.userId);
    if (!caller || caller.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede crear usuarios' });
    const { name, email, password, role, employee_id } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });
    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'Email ya registrado' });
    const userRole = ['jefe', 'empleado'].includes(role) ? role : 'empleado';
    const ref = await getDb().collection('users').add({
      name, email, password: bcrypt.hashSync(password, 10),
      business_name: caller.business_name || '',
      role: userRole, employee_id: employee_id || null,
      logo: null, created_at: new Date().toISOString()
    });
    res.json({ success: true, user: { id: ref.id, name, email, role: userRole } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', auth, async (req, res) => {
  try {
    const caller = await getUserById(req.userId);
    if (!caller || caller.role !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    const snap = await getDb().collection('users').where('business_name', '==', caller.business_name || '').get();
    const users = snap.docs.map(d => ({ id: d.id, name: d.data().name, email: d.data().email, role: d.data().role || 'admin', employee_id: d.data().employee_id }));
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
