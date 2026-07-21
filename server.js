const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/services', require('./routes/services'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/loyalty', require('./routes/loyalty'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/bot', require('./routes/bot'));
app.use('/api/integrations', require('./routes/integrations'));
app.use('/api/public', require('./routes/public'));

// API error handler - returns JSON, not HTML
app.use('/api', (err, req, res, next) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// Helper: find user by slug (checks business_slug field, then normalizes business_name)
async function findUserBySlug(db, slug) {
  // 1. Try business_slug field directly
  let snap = await db.collection('users').where('business_slug', '==', slug).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // 2. Try all users and match normalized business_name
  const allUsers = await db.collection('users').get();
  for (const doc of allUsers.docs) {
    const data = doc.data();
    const nameSlug = (data.business_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (nameSlug === slug) {
      // Auto-save the slug for next time
      await db.collection('users').doc(doc.id).update({ business_slug: slug });
      return { id: doc.id, ...data };
    }
  }
  return null;
}

// ===================== SLUG-BASED WEBHOOKS =====================
// WhatsApp webhook (Meta verification + message handling)
app.get('/api/webhooks/whatsapp/:slug', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).send('Business not found');
    const settingsDoc = await db.collection('users').doc(user.id).collection('settings').doc('main').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    if (mode === 'subscribe' && token === settings.whatsapp_verify_token) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } catch (err) { res.sendStatus(500); }
});

app.post('/api/webhooks/whatsapp/:slug', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).json({ error: 'Business not found' });
    const { handleBotMessage } = require('./routes/bot');
    const body = req.body;
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const messages = changes?.value?.messages;
    if (messages && messages.length > 0) {
      const msg = messages[0];
      const from = msg.from;
      const text = msg.text?.body || '';
      await handleBotMessage('whatsapp', from, text, '', user.id);
    }
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

// Instagram webhook (Meta verification + message handling)
app.get('/api/webhooks/instagram/:slug', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).send('Business not found');
    const settingsDoc = await db.collection('users').doc(user.id).collection('settings').doc('main').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    if (mode === 'subscribe' && token === settings.instagram_verify_token) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } catch (err) { res.sendStatus(500); }
});

app.post('/api/webhooks/instagram/:slug', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).json({ error: 'Business not found' });
    const { handleBotMessage } = require('./routes/bot');
    const body = req.body;
    const entry = body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    if (messaging) {
      const from = messaging.sender?.id || '';
      const text = messaging.message?.text || '';
      if (text) {
        await handleBotMessage('instagram', from, text, '', user.id);
      }
    }
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

// Public webcal endpoint (no auth - uses slug)
app.get('/cal/:slug.ics', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const slug = req.params.slug;
    
    const user = await findUserBySlug(db, slug);
    if (!user) return res.status(404).send('Negocio no encontrado');
    
    const userId = user.id;
    const settingsDoc = await db.collection('users').doc(userId).collection('settings').doc('main').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    
    // Get bookings
    const bookingsSnap = await db.collection('users').doc(userId).collection('bookings').get();
    const bookings = bookingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled');
    
    // Generate ICS
    const pad = (n) => String(n).padStart(2, '0');
    const fmtICSDate = (date, time) => {
      const [y, m, d] = date.split('-');
      const [h, min] = (time || '09:00').split(':');
      return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    };
    
    let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gestria//Reservas//ES\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:${settings.business_name || slug} - Reservas\r\nX-WR-TIMEZONE:Europe/Madrid\r\n`;
    
    for (const b of upcoming) {
      const uid = b.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const dtStart = fmtICSDate(b.date, b.start_time);
      const dtEnd = fmtICSDate(b.date, b.end_time);
      const nowICS = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      ics += `BEGIN:VEVENT\r\nUID:${uid}@gestria\r\nDTSTAMP:${nowICS}\r\nDTSTART:${dtStart}\r\nDTEND:${dtEnd}\r\nSUMMARY:${b.service_name || 'Reserva'} - ${b.client_name || 'Cliente'}\r\nDESCRIPTION:Servicio: ${b.service_name}\\nCliente: ${b.client_name}\\nEmpleado: ${b.employee_name}\r\nLOCATION:${settings.business_name || ''}\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\n`;
    }
    
    ics += 'END:VCALENDAR';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}-reservas.ics"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(ics);
  } catch (err) { res.status(500).send('Error: ' + err.message); }
});

// Public booking page for a business
app.get('/b/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// Catch-all for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Gestria server running on http://localhost:${PORT}`);
});
