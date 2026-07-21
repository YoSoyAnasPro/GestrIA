const express = require('express');
const router = express.Router();
const { getBookings, getBlockedTimes, getEmployees, createBooking, updateBooking, cancelBooking } = require('../database');
const { auth } = require('../middleware/auth');

router.use(auth);

router.get('/', async (req, res) => {
  try {
    const { date, start_date, end_date, employee_id, service_id } = req.query;
    const bookings = await getBookings(req.userId, { date, start_date, end_date, employee_id, service_id });
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { client_id, employee_id, service_id, date, start_time, client_name, employee_name, employee_color, service_name, service_price, service_color, service_duration, notes } = req.body;
    const duration = service_duration || 30;
    const [h, m] = start_time.split(':').map(Number);
    const endMin = h * 60 + m + duration;
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;

    const bookings = await getBookings(req.userId, { date, employee_id });
    const conflict = bookings.find(b => b.employee_id === employee_id && b.status !== 'cancelled' && ((b.start_time < end_time && b.end_time > start_time)));
    if (conflict) return res.status(400).json({ error: 'Horario ocupado para este empleado' });

    if (client_id) {
      const existingBooking = bookings.find(b => b.client_id === client_id && b.status !== 'cancelled');
      if (existingBooking) return res.status(400).json({ error: 'Ya tienes una reserva para este día. Solo se permite una reserva por cliente al día.' });
    }

    const blocked = await getBlockedTimes(req.userId, { employee_id, date });
    const blockedConflict = blocked.find(b => !b.start_time || (b.start_time < end_time && b.end_time > start_time));
    if (blockedConflict) return res.status(400).json({ error: 'Empleado no disponible en ese horario' });

    const booking = await createBooking(req.userId, { client_id, employee_id, service_id, date, start_time, end_time, client_name, employee_name, employee_color, service_name, service_price, service_color, notes: notes || '' });
    res.json(booking);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    await updateBooking(req.userId, req.params.id, req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await cancelBooking(req.userId, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
