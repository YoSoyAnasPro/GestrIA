const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas peticiones' } });
app.use('/api/', generalLimiter);
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados intentos' } });
const bookingLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas reservas' } });

app.use(express.json({ limit: '5mb' }));

function sanitize(obj) {
  if (typeof obj === 'string') return obj.replace(/<[^>]*>/g, '').trim().substring(0, 1000);
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('$') || k.startsWith('_')) continue;
      clean[k] = sanitize(v);
    }
    return clean;
  }
  return obj;
}
app.use('/api', (req, res, next) => {
  if (req.body && typeof req.body === 'object') req.body = sanitize(req.body);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ===================== API ROUTES =====================
app.use('/api/auth', authLimiter, require('./routes/auth'));
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
app.use('/api/public', bookingLimiter, require('./routes/public'));
app.use('/api/stripe', require('./routes/stripe'));

// API error handler
app.use('/api', (err, req, res, next) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

// ===================== HELPERS =====================
async function findUserBySlug(db, slug) {
  let snap = await db.collection('users').where('business_slug', '==', slug).limit(1).get();
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  const allUsers = await db.collection('users').get();
  for (const doc of allUsers.docs) {
    const data = doc.data();
    const nameSlug = (data.business_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (nameSlug === slug) {
      await db.collection('users').doc(doc.id).update({ business_slug: slug });
      return { id: doc.id, ...data };
    }
  }
  return null;
}

// ===================== WEBHOOKS =====================
app.get('/api/webhooks/whatsapp/:slug', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).send('Not found');
    const sDoc = await db.collection('users').doc(user.id).collection('settings').doc('main').get();
    const s = sDoc.exists ? sDoc.data() : {};
    if (mode === 'subscribe' && token === s.whatsapp_verify_token) return res.status(200).send(challenge);
    res.sendStatus(403);
  } catch (err) { res.sendStatus(500); }
});

app.post('/api/webhooks/whatsapp/:slug', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.sendStatus(200);
    const { handleBotMessage } = require('./routes/bot');
    const msgs = req.body.entry?.[0]?.changes?.[0]?.value?.messages;
    if (msgs && msgs[0]) await handleBotMessage('whatsapp', msgs[0].from, msgs[0].text?.body || '', '', user.id);
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

app.get('/api/webhooks/instagram/:slug', async (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).send('Not found');
    const sDoc = await db.collection('users').doc(user.id).collection('settings').doc('main').get();
    const s = sDoc.exists ? sDoc.data() : {};
    if (mode === 'subscribe' && token === s.instagram_verify_token) return res.status(200).send(challenge);
    res.sendStatus(403);
  } catch (err) { res.sendStatus(500); }
});

app.post('/api/webhooks/instagram/:slug', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.sendStatus(200);
    const { handleBotMessage } = require('./routes/bot');
    const m = req.body.entry?.[0]?.messaging?.[0];
    if (m && m.message && m.message.text) await handleBotMessage('instagram', m.sender?.id || '', m.message.text, '', user.id);
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

// ===================== PUBLIC ICS =====================
app.get('/cal/:slug.ics', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const user = await findUserBySlug(db, req.params.slug);
    if (!user) return res.status(404).send('No encontrado');
    const sDoc = await db.collection('users').doc(user.id).collection('settings').doc('main').get();
    const settings = sDoc.exists ? sDoc.data() : {};
    const bSnap = await db.collection('users').doc(user.id).collection('bookings').get();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const upcoming = bSnap.docs.map(d => d.data()).filter(b => b.date >= today && b.status !== 'cancelled');
    const pad = n => String(n).padStart(2, '0');
    const fmt = (date, time) => {
      const [y, m, d] = date.split('-');
      const [h, min] = (time || '09:00').split(':');
      return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    };
    let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Gestria//ES\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:${settings.business_name || req.params.slug}\r\nX-WR-TIMEZONE:Europe/Madrid\r\n`;
    for (const b of upcoming) {
      ics += `BEGIN:VEVENT\r\nUID:${b.id || Date.now()}@gestria\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'}\r\nDTSTART:${fmt(b.date, b.start_time)}\r\nDTEND:${fmt(b.date, b.end_time)}\r\nSUMMARY:${b.service_name || 'Reserva'} - ${b.client_name || ''}\r\nDESCRIPTION:Servicio: ${b.service_name}\\nCliente: ${b.client_name}\\nEmpleado: ${b.employee_name}\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\n`;
    }
    ics += 'END:VCALENDAR';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}.ics"`);
    res.send(ics);
  } catch (err) { res.status(500).send('Error'); }
});

// ===================== PAGE ROUTES =====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/b/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'booking.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// ===================== BOOKING REMINDERS =====================
async function sendReminders() {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dateStr = `${in24h.getFullYear()}-${String(in24h.getMonth()+1).padStart(2,'0')}-${String(in24h.getDate()).padStart(2,'0')}`;
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      const sDoc = await db.collection('users').doc(userId).collection('settings').doc('main').get();
      const settings = sDoc.exists ? sDoc.data() : {};
      if (!settings.reminder_24h) continue;
      const bSnap = await db.collection('users').doc(userId).collection('bookings')
        .where('date', '==', dateStr).where('status', '==', 'confirmed').get();
      for (const bDoc of bSnap.docs) {
        const b = bDoc.data();
        const sentCol = db.collection('users').doc(userId).collection('reminders_sent');
        const alreadySent = await sentCol.where('booking_id', '==', bDoc.id).where('type', '==', '24h').limit(1).get();
        if (!alreadySent.empty) continue;
        if (b.client_email && settings.smtp_host) {
          try {
            const nodemailer = require('nodemailer');
            const t = nodemailer.createTransport({ host: settings.smtp_host, port: settings.smtp_port || 587, secure: (settings.smtp_port || 587) === 465, auth: { user: settings.smtp_user, pass: settings.smtp_pass } });
            const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
            const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            const d = new Date(b.date + 'T00:00:00');
            const dateLabel = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
            const bizName = settings.business_name || 'Nuestro negocio';
            await t.sendMail({
              from: `"${bizName}" <${settings.smtp_user}>`,
              to: b.client_email,
              subject: `Recordatorio: tu cita mañana - ${bizName}`,
              text: `Hola ${b.client_name}, te recordamos tu cita mañana.\n\nServicio: ${b.service_name}\nFecha: ${dateLabel}\nHora: ${b.start_time} - ${b.end_time}${b.employee_name ? '\nProfesional: ' + b.employee_name : ''}\n\n¡Te esperamos!`,
              html: `<div style="font-family:Arial;max-width:480px;margin:0 auto"><div style="background:linear-gradient(135deg,#1b263b,#415a77);padding:24px;text-align:center;border-radius:12px 12px 0 0"><h1 style="color:white;font-size:20px;margin:0">Recordatorio de cita</h1><p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px">${bizName}</p></div><div style="padding:24px;background:#f8f9fb;border-radius:0 0 12px 12px"><p style="color:#5a6b7f">Hola <strong>${b.client_name}</strong>, te recordamos tu cita <strong>mañana</strong>:</p><div style="background:white;border-radius:10px;padding:16px;margin:16px 0"><p style="margin:4px 0"><span style="color:#8a97a8">Servicio:</span> <strong>${b.service_name}</strong></p><p style="margin:4px 0"><span style="color:#8a97a8">Fecha:</span> <strong>${dateLabel}</strong></p><p style="margin:4px 0"><span style="color:#8a97a8">Hora:</span> <strong>${b.start_time} - ${b.end_time}</strong></p>${b.employee_name ? `<p style="margin:4px 0"><span style="color:#8a97a8">Profesional:</span> <strong>${b.employee_name}</strong></p>` : ''}</div><p style="text-align:center;color:#2d936c;font-weight:700">¡Te esperamos!</p></div></div>`
            });
          } catch (e) { console.error('[Reminder] Email failed:', e.message); }
        }
        if (b.client_phone && settings.whatsapp_token && settings.whatsapp_phone_number_id) {
          try {
            const phone = b.client_phone.replace(/[\s\-()]/g, '');
            const to = phone.startsWith('+') ? phone.substring(1) : phone;
            const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
            const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
            const d = new Date(b.date + 'T00:00:00');
            const dateLabel = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
            await fetch(`https://graph.facebook.com/v18.0/${settings.whatsapp_phone_number_id}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${settings.whatsapp_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: `*Recordatorio de cita*\n\nHola ${b.client_name}, te recordamos tu cita *mañana*:\n\nServicio: *${b.service_name}*\nFecha: *${dateLabel}*\nHora: *${b.start_time} - ${b.end_time}*${b.employee_name ? '\nProfesional: *' + b.employee_name + '*' : ''}\n\n¡Te esperamos!` } })
            });
          } catch (e) { console.error('[Reminder] WhatsApp failed:', e.message); }
        }
        await sentCol.add({ booking_id: bDoc.id, type: '24h', sent_at: new Date().toISOString() });
      }
    }
    console.log('[Reminders] Check completed at', new Date().toLocaleTimeString());
  } catch (err) { console.error('[Reminders] Error:', err.message); }
}

if (!process.env.VERCEL) {
  cron.schedule('0 * * * *', sendReminders);
}

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Gestria server running on http://localhost:${PORT}`);
  });
}
