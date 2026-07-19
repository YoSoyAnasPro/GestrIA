const express = require('express');
const router = express.Router();
const { getBookings, getPayments, getReviews, getClients, getStatsOverview, getAIInsights, getSettings, getEmployees } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/overview', async (req, res) => {
  try { res.json(await getStatsOverview(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/revenue', async (req, res) => {
  try {
    const payments = await getPayments(req.userId);
    const grouped = {};
    payments.forEach(p => {
      const d = p.created_at?.split(' ')[0] || p.created_at?.split('T')[0] || 'unknown';
      if (!grouped[d]) grouped[d] = { label: d, total: 0, count: 0 };
      grouped[d].total += p.amount || 0;
      grouped[d].count++;
    });
    res.json(Object.values(grouped).sort((a, b) => a.label.localeCompare(b.label)).slice(-30));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/services', async (req, res) => {
  try {
    const bookings = await getBookings(req.userId);
    const completed = bookings.filter(b => b.status !== 'cancelled');
    const grouped = {};
    completed.forEach(b => {
      if (!grouped[b.service_id]) grouped[b.service_id] = { name: b.service_name, color: b.service_color, count: 0, revenue: 0 };
      grouped[b.service_id].count++;
      grouped[b.service_id].revenue += b.service_price || 0;
    });
    res.json(Object.values(grouped).sort((a, b) => b.count - a.count));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/employees', async (req, res) => {
  try {
    const employees = await getEmployees(req.userId);
    const bookings = await getBookings(req.userId);
    const reviews = await getReviews(req.userId);
    const result = employees.map(e => {
      const empBookings = bookings.filter(b => b.employee_id === e.id);
      const completed = empBookings.filter(b => b.status === 'completed');
      const cancelled = empBookings.filter(b => b.status === 'cancelled');
      const empReviews = reviews.filter(r => empBookings.some(b => b.id === r.booking_id));
      const avgRating = empReviews.length > 0 ? empReviews.reduce((s, r) => s + r.rating, 0) / empReviews.length : null;
      return {
        id: e.id, name: e.name, color: e.color,
        total_bookings: empBookings.length,
        completed: completed.length,
        cancelled: cancelled.length,
        revenue: completed.reduce((s, b) => s + (b.service_price || 0), 0),
        avg_rating: avgRating
      };
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/clients', async (req, res) => {
  try {
    const clients = await getClients(req.userId);
    const sorted = [...clients].sort((a, b) => (b.visits || 0) - (a.visits || 0));
    const topClient = sorted[0] || null;
    const inactive = clients.filter(c => c.last_visit && (new Date() - new Date(c.last_visit)) > 90 * 86400000);
    const vip = [...clients].sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0)).slice(0, 10);
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const birthdays = clients.filter(c => {
      if (!c.birthday) return false;
      const month = parseInt(c.birthday.split('-')[0]);
      return month === currentMonth;
    });
    res.json({ topClient, inactive, vip, birthdays });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/heatmap', async (req, res) => {
  try {
    const bookings = await getBookings(req.userId);
    const completed = bookings.filter(b => b.status !== 'cancelled');
    const hourCount = {};
    completed.forEach(b => {
      const h = parseInt(b.start_time?.split(':')[0] || 0);
      hourCount[h] = (hourCount[h] || 0) + 1;
    });
    const data = Object.entries(hourCount).map(([hour, count]) => ({ hour: parseInt(hour), count })).sort((a, b) => a.hour - b.hour);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/ai-insights', async (req, res) => {
  try { res.json(await getAIInsights(req.userId)); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
