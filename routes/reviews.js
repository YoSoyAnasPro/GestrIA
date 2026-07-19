const express = require('express');
const router = express.Router();
const { getReviews, createReview } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try { res.json(await getReviews(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try { res.json(await createReview(req.userId, req.body)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/average', async (req, res) => {
  try {
    const reviews = await getReviews(req.userId);
    const total = reviews.length;
    const avg = total > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
    res.json({ average: avg, total });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
