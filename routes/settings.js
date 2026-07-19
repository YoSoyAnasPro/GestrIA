const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getSettings(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/', async (req, res) => {
  try { await updateSettings(req.userId, req.body); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
