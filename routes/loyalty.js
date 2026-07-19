const express = require('express');
const router = express.Router();
const { getClients, getSettings, getClient, updateClient } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/client/:id', async (req, res) => {
  try {
    const client = await getClient(req.userId, req.params.id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    const settings = await getSettings(req.userId);
    const needed = Math.max(0, (settings.loyalty_free_service_threshold || 150) - (client.points || 0));
    res.json({ points: client.points || 0, needed, threshold: settings.loyalty_free_service_threshold || 150 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/leaderboard', async (req, res) => {
  try {
    const clients = await getClients(req.userId);
    const top = clients.sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 10).map(c => ({ id: c.id, name: c.name, points: c.points || 0, visits: c.visits || 0 }));
    res.json(top);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/add', async (req, res) => {
  try {
    const client = await getClient(req.userId, req.body.client_id);
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });
    await updateClient(req.userId, req.body.client_id, { points: (client.points || 0) + req.body.points });
    res.json({ id: client.id, name: client.name, points: (client.points || 0) + req.body.points });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
