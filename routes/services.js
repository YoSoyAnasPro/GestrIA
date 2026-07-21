const express = require('express');
const router = express.Router();
const { getServices, createService, updateService, deleteService } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getServices(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, price, duration, category } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del servicio es obligatorio' });
    if (price === undefined || price < 0) return res.status(400).json({ error: 'El precio debe ser mayor o igual a 0' });
    if (!duration || duration < 5 || duration > 480) return res.status(400).json({ error: 'La duración debe ser entre 5 y 480 minutos' });
    res.json(await createService(req.userId, { ...req.body, name: name.trim(), category: (category || 'general').trim() }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    if (req.body.name !== undefined && !req.body.name?.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    if (req.body.price !== undefined && req.body.price < 0) return res.status(400).json({ error: 'El precio no puede ser negativo' });
    if (req.body.duration !== undefined && (req.body.duration < 5 || req.body.duration > 480)) return res.status(400).json({ error: 'La duración debe ser entre 5 y 480 minutos' });
    if (req.body.name) req.body.name = req.body.name.trim();
    if (req.body.category) req.body.category = req.body.category.trim();
    await updateService(req.userId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await deleteService(req.userId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
