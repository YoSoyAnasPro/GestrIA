const express = require('express');
const router = express.Router();
const { getBlockedTimes, createBlockedTime, deleteBlockedTime, getHolidays, createHoliday, deleteHoliday } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getBlockedTimes(req.userId, req.query)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json(await createBlockedTime(req.userId, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await deleteBlockedTime(req.userId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/holidays', async (req, res) => {
  try { res.json(await getHolidays(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/holidays', async (req, res) => {
  try { res.json(await createHoliday(req.userId, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/holidays/:id', async (req, res) => {
  try { await deleteHoliday(req.userId, req.params.id); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
