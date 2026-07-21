const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, getBookings } = require('../database');
const { auth } = require('../middleware/auth');

// ===================== GOOGLE MAPS REVIEWS =====================
router.post('/google-maps/save-reviews', auth, async (req, res) => {
  try {
    const { reviews } = req.body;
    if (!reviews || !reviews.length) return res.status(400).json({ error: 'No hay reseñas para guardar' });
    const { getDb } = require('../firebase');
    const db = getDb();
    let imported = 0;
    for (const r of reviews) {
      if (!r.author || !r.text) continue;
      const existing = await db.collection('users').doc(req.userId).collection('reviews')
        .where('source', '==', 'google_maps').where('author', '==', r.author).where('text', '==', r.text).limit(1).get();
      if (existing.empty) {
        await db.collection('users').doc(req.userId).collection('reviews').add({
          client_name: r.author,
          rating: r.rating || 5,
          comment: r.text,
          source: 'google_maps',
          created_at: r.time || new Date().toISOString()
        });
        imported++;
      }
    }
    res.json({ success: true, imported });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-maps/add-review', auth, async (req, res) => {
  try {
    const { author, rating, text } = req.body;
    if (!author || !text) return res.status(400).json({ error: 'Autor y texto son obligatorios' });
    const { getDb } = require('../firebase');
    const db = getDb();
    await db.collection('users').doc(req.userId).collection('reviews').add({
      client_name: author, rating: rating || 5, comment: text, source: 'google_maps', created_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-maps/status', auth, async (req, res) => {
  try {
    const { getDb } = require('../firebase');
    const db = getDb();
    const snap = await db.collection('users').doc(req.userId).collection('reviews')
      .where('source', '==', 'google_maps').get();
    res.json({ connected: true, review_count: snap.size });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== GOOGLE CALENDAR =====================
function generateICS(bookings, businessName) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmtICSDate = (date, time) => {
    const [y, m, d] = date.split('-');
    const [h, min] = (time || '09:00').split(':');
    return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
  };

  let ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Gestria//Reservas//ES\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\nX-WR-CALNAME:${businessName || 'Gestria'} - Reservas\nX-WR-TIMEZONE:Europe/Madrid\n`;

  for (const b of bookings) {
    const uid = b.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const dtStart = fmtICSDate(b.date, b.start_time);
    const dtEnd = fmtICSDate(b.date, b.end_time);
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    ics += `BEGIN:VEVENT\nUID:${uid}@gestria\nDTSTAMP:${now}\nDTSTART:${dtStart}\nDTEND:${dtEnd}\nSUMMARY:${b.service_name || 'Reserva'} - ${b.client_name || 'Cliente'}\nDESCRIPTION:Reserva en ${businessName || 'Gestria'}\\nServicio: ${b.service_name}\\nCliente: ${b.client_name}\\nEmpleado: ${b.employee_name}\\nEstado: ${b.status}\nLOCATION:${businessName || ''}\nSTATUS:CONFIRMED\nEND:VEVENT\n`;
  }

  ics += 'END:VCALENDAR';
  return ics;
}

router.get('/google-calendar/link', auth, (req, res) => {
  try {
    const { title, start, end, description, location } = req.query;
    if (!title || !start) return res.status(400).json({ error: 'Título y fecha requeridos' });
    const fmtDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const params = new URLSearchParams({
      action: 'TEMPLATE', text: title,
      dates: `${fmtDate(start)}/${fmtDate(end || start)}`,
      details: description || '', location: location || ''
    });
    res.json({ url: `https://calendar.google.com/calendar/render?${params.toString()}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-calendar/ics', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(401).send('Token required');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gestria_secret');
    const userId = decoded.userId;
    const settings = await getSettings(userId);
    const bookings = await getBookings(userId);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled');
    const ics = generateICS(upcoming, settings.business_name);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gestria-reservas.ics"');
    res.send(ics);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-calendar/bulk', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const bookings = await getBookings(req.userId);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled');
    const links = upcoming.map(b => {
      const title = `${b.service_name || 'Reserva'} - ${b.client_name || 'Cliente'}`;
      const start = `${b.date}T${b.start_time}`;
      const end = `${b.date}T${b.end_time}`;
      const details = `Servicio: ${b.service_name}\nCliente: ${b.client_name}\nEmpleado: ${b.employee_name}`;
      const fmtDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const params = new URLSearchParams({
        action: 'TEMPLATE', text: title,
        dates: `${fmtDate(start)}/${fmtDate(end)}`,
        details, location: settings.business_name || ''
      });
      return { ...b, calendar_url: `https://calendar.google.com/calendar/render?${params.toString()}` };
    });
    res.json({ bookings: links, total: links.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-calendar/status', auth, async (req, res) => {
  res.json({ connected: true, message: 'Sincronización disponible mediante enlaces y suscripción webcal' });
});

// ===================== INSTAGRAM =====================
router.get('/instagram/status', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const connected = !!(settings.instagram_page_id && settings.instagram_token);
    res.json({ connected, page_id: settings.instagram_page_id || null, verify_token: settings.instagram_verify_token || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/configure', auth, async (req, res) => {
  try {
    const { page_id, access_token } = req.body;
    if (!page_id || !access_token) return res.status(400).json({ error: 'Page ID y Access Token requeridos' });
    const verifyToken = 'gestria_ig_' + Math.random().toString(36).substr(2, 12);
    await updateSettings(req.userId, { instagram_page_id: page_id, instagram_token: access_token, instagram_verify_token: verifyToken });
    res.json({ success: true, verify_token: verifyToken });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/disconnect', auth, async (req, res) => {
  try {
    await updateSettings(req.userId, { instagram_page_id: '', instagram_token: '', instagram_verify_token: '' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== WHATSAPP =====================
router.get('/whatsapp/status', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const connected = !!(settings.whatsapp_phone_number_id && settings.whatsapp_token);
    res.json({ connected, phone_number_id: settings.whatsapp_phone_number_id || null, business_account_id: settings.whatsapp_business_account_id || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/configure', auth, async (req, res) => {
  try {
    const { phone_number_id, business_account_id, access_token } = req.body;
    if (!phone_number_id || !access_token) return res.status(400).json({ error: 'Phone Number ID y Access Token requeridos' });
    await updateSettings(req.userId, { whatsapp_phone_number_id: phone_number_id, whatsapp_business_account_id: business_account_id || '', whatsapp_token: access_token });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/disconnect', auth, async (req, res) => {
  try {
    await updateSettings(req.userId, { whatsapp_phone_number_id: '', whatsapp_business_account_id: '', whatsapp_token: '' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
