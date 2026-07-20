const express = require('express');
const router = express.Router();
const { getBookings, getClients, getBlockedTimes, getEmployees } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const uid = req.userId;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const allBookings = await getBookings(uid);
    const todayBookings = allBookings.filter(b => b.date === today && b.status !== 'cancelled').sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

    const todayRevenue = todayBookings.reduce((sum, b) => sum + (b.service_price || 0), 0);
    const uniqueClients = new Set(todayBookings.map(b => b.client_id)).size;

    const employees = await getEmployees(uid);
    const dayOfWeek = new Date().getDay();
    let totalSlots = 0;
    for (const emp of employees) {
      const sched = emp.schedules?.find(s => parseInt(s.day_of_week) === dayOfWeek);
      if (sched) {
        const [sh, sm] = sched.start_time.split(':').map(Number);
        const [eh, em] = sched.end_time.split(':').map(Number);
        totalSlots += Math.floor(((eh * 60 + em) - (sh * 60 + sm)) / 30);
      }
    }
    const occupation = totalSlots > 0 ? Math.round((todayBookings.length / Math.max(totalSlots, 1)) * 100) : 0;
    const nowTime = new Date().toTimeString().slice(0, 5);
    const nextBooking = todayBookings.find(b => b.start_time > nowTime);

    const recentBookings = allBookings.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.start_time || '').localeCompare(a.start_time || '')).slice(0, 10);

    const allClients = await getClients(uid);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    const newClients = allClients.filter(c => c.created_at && c.created_at >= weekAgoStr).slice(0, 5);

    const alerts = [];
    const blocked = await getBlockedTimes(uid, { date: today });
    const employeesMap = {};
    employees.forEach(e => { employeesMap[e.id] = e.name; });
    blocked.filter(b => b.type === 'vacation' || b.type === 'illness').forEach(b => {
      const name = b.employee_id ? (employeesMap[b.employee_id] || 'Empleado') : 'General';
      alerts.push({ type: 'warning', message: `${name} está de ${b.type === 'vacation' ? 'vacaciones' : 'enfermedad'}` });
    });
    const pending = allBookings.filter(b => b.status === 'pending').length;
    if (pending > 0) alerts.push({ type: 'info', message: `${pending} reservas pendientes de confirmar` });

    res.json({
      today: { bookings: todayBookings, revenue: todayRevenue, clients: uniqueClients, occupation: Math.min(occupation, 100) },
      nextBooking,
      recentBookings,
      newClients,
      alerts
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
