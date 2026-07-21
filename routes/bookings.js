const express = require('express');
const router = express.Router();
const { getBookings, getBlockedTimes, getEmployees, createBooking, updateBooking, cancelBooking, getSettings } = require('../database');
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
    const bookings = await getBookings(req.userId);
    const booking = bookings.find(b => b.id === req.params.id);
    await cancelBooking(req.userId, req.params.id);
    if (booking && (booking.client_email || booking.client_phone)) {
      const settings = await getSettings(req.userId);
      const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
      const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const d = new Date(booking.date + 'T00:00:00');
      const dateStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
      const bizName = settings.business_name || 'Nuestro negocio';
      if (booking.client_email && settings.smtp_host) {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({ host: settings.smtp_host, port: settings.smtp_port || 587, secure: (settings.smtp_port || 587) === 465, auth: { user: settings.smtp_user, pass: settings.smtp_pass } });
        await transporter.sendMail({ from: `"${bizName}" <${settings.smtp_user}>`, to: booking.client_email, subject: `Reserva cancelada - ${bizName}`, text: `Tu reserva ha sido cancelada.\n\nServicio: ${booking.service_name}\nFecha: ${dateStr}\nHora: ${booking.start_time} - ${booking.end_time}`, html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><div style="background:#c1292e;color:white;padding:24px;text-align:center;border-radius:12px 12px 0 0"><h2 style="margin:0">Reserva cancelada</h2></div><div style="padding:24px;background:#f8f9fb;border-radius:0 0 12px 12px"><p style="color:#5a6b7f">Tu reserva en <strong>${bizName}</strong> ha sido cancelada.</p><div style="background:white;border-radius:8px;padding:16px;margin:16px 0"><p><strong>Servicio:</strong> ${booking.service_name}</p><p><strong>Fecha:</strong> ${dateStr}</p><p><strong>Hora:</strong> ${booking.start_time} - ${booking.end_time}</p></div><p style="color:#8a97a8;font-size:12px;text-align:center">Si crees que es un error, contacta directamente con nosotros.</p></div></div>` });
      }
      if (booking.client_phone && settings.whatsapp_token && settings.whatsapp_phone_number_id) {
        const phone = booking.client_phone.replace(/[\s\-()]/g, '');
        const to = phone.startsWith('+') ? phone.substring(1) : phone;
        await fetch(`https://graph.facebook.com/v18.0/${settings.whatsapp_phone_number_id}/messages`, { method: 'POST', headers: { 'Authorization': `Bearer ${settings.whatsapp_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: `❌ *Reserva cancelada*\n\nNegocio: *${bizName}*\nServicio: *${booking.service_name}*\nFecha: *${dateStr}*\nHora: *${booking.start_time} - ${booking.end_time}*\n\nSi crees que es un error, contacta directamente con nosotros.` } }) });
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
