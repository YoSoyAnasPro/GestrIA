const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createUser, getUserByEmail, getUserById } = require('../database');
const { auth, SECRET } = require('../middleware/auth');

router.post('/register', async (req, res) => {
  const { name, email, password, business_name } = req.body;
  try {
    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: 'Email ya registrado' });
    const user = await createUser(name, email, password, business_name);
    const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await getUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    const token = jwt.sign({ userId: user.id }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, business_name: user.business_name } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ id: user.id, name: user.name, email: user.email, business_name: user.business_name, logo: user.logo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
