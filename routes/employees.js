const express = require('express');
const router = express.Router();
const { getEmployees, createEmployee, updateEmployee, deleteEmployee } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getEmployees(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre del empleado es obligatorio' });
    res.json(await createEmployee(req.userId, { ...req.body, name: name.trim() }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    if (req.body.name !== undefined && !req.body.name?.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    if (req.body.name) req.body.name = req.body.name.trim();
    await updateEmployee(req.userId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await deleteEmployee(req.userId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
