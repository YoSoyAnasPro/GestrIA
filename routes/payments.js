const express = require('express');
const router = express.Router();
const { getPayments, createPayment } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getPayments(req.userId, req.query)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json(await createPayment(req.userId, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
