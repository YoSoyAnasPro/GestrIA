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
    const allBookings = await getBookings(req.userId);
    const history = allBookings.filter(b => b.client_id === req.params.id && b.status === 'completed').sort((a, b) => b.date?.localeCompare(a.date)).slice(0, 20);
    const allReviews = await getReviews(req.userId);
    const reviews = allReviews.filter(r => r.client_id === req.params.id).slice(0, 10);
    res.json({ ...client, history, reviews });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json(await createClient(req.userId, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await updateClient(req.userId, req.params.id, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await deleteClient(req.userId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
