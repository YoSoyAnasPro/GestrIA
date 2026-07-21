const express = require('express');
const router = express.Router();
const { getClients, getClient, createClient, updateClient, deleteClient, getBookings, getReviews } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getClients(req.userId, req.query.search)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const client = await getClient(req.userId, req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (client.user_id && client.user_id !== req.userId) return res.status(403).json({ error: 'No autorizado' });
    const allBookings = await getBookings(req.userId);
    const history = allBookings.filter(b => b.client_id === req.params.id && b.status === 'completed').sort((a, b) => b.date?.localeCompare(a.date)).slice(0, 20);
    const allReviews = await getReviews(req.userId);
    const reviews = allReviews.filter(r => r.client_id === req.params.id).slice(0, 10);
    res.json({ ...client, history, reviews });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (phone && !/^\+?\d{7,15}$/.test(phone.replace(/[\s\-()]/g, ''))) return res.status(400).json({ error: 'Teléfono no válido' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email no válido' });
    res.json(await createClient(req.userId, { ...req.body, name: name.trim() }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const client = await getClient(req.userId, req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (req.body.name !== undefined && !req.body.name?.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    if (req.body.phone && !/^\+?\d{7,15}$/.test(req.body.phone.replace(/[\s\-()]/g, ''))) return res.status(400).json({ error: 'Teléfono no válido' });
    if (req.body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.email)) return res.status(400).json({ error: 'Email no válido' });
    res.json(await updateClient(req.userId, req.params.id, req.body));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await deleteClient(req.userId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
