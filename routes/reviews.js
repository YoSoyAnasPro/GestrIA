const express = require('express');
const router = express.Router();
const { getReviews, createReview } = require('../database');
const { getDb } = require('../firebase');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const internalReviews = await getReviews(req.userId);
    const snap = await getDb().collection('users').doc(req.userId).collection('reviews')
      .where('source', '==', 'google_maps').get();
    const googleReviews = snap.docs.map(d => ({ id: d.id, ...d.data(), source: 'google_maps' }));

    const all = [...internalReviews, ...googleReviews].sort((a, b) => {
      const da = a.created_at || '';
      const db = b.created_at || '';
      return db.localeCompare(da);
    });
    res.json(all);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body, source: req.body.source || 'internal' };
    res.json(await createReview(req.userId, data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/average', async (req, res) => {
  try {
    const reviews = await getReviews(req.userId);
    const snap = await getDb().collection('users').doc(req.userId).collection('reviews')
      .where('source', '==', 'google_maps').get();
    const googleReviews = snap.docs.map(d => d.data());
    const all = [...reviews, ...googleReviews];
    const total = all.length;
    const avg = total > 0 ? all.reduce((s, r) => s + (r.rating || 0), 0) / total : 0;
    res.json({ average: avg, total, internal: reviews.length, google: googleReviews.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
