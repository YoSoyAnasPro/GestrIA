const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
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

// Public webcal endpoint (no auth - uses slug)
app.get('/cal/:slug.ics', async (req, res) => {
  try {
    const { getDb } = require('./firebase');
    const db = getDb();
    const slug = req.params.slug;
    
    // Find user by business_slug
    const usersSnap = await db.collection('users').where('business_slug', '==', slug).limit(1).get();
    if (usersSnap.empty) return res.status(404).send('Negocio no encontrado');
    
    const userDoc = usersSnap.docs[0];
    const userId = userDoc.id;
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
    
    let ics = `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Gestria//Reservas//ES\nCALSCALE:GREGORIAN\nMETHOD:PUBLISH\nX-WR-CALNAME:${settings.business_name || slug} - Reservas\nX-WR-TIMEZONE:Europe/Madrid\n`;
    
    for (const b of upcoming) {
      const uid = b.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const dtStart = fmtICSDate(b.date, b.start_time);
      const dtEnd = fmtICSDate(b.date, b.end_time);
      const nowICS = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      ics += `BEGIN:VEVENT\nUID:${uid}@gestria\nDTSTAMP:${nowICS}\nDTSTART:${dtStart}\nDTEND:${dtEnd}\nSUMMARY:${b.service_name || 'Reserva'} - ${b.client_name || 'Cliente'}\nDESCRIPTION:Servicio: ${b.service_name}\\nCliente: ${b.client_name}\\nEmpleado: ${b.employee_name}\nLOCATION:${settings.business_name || ''}\nSTATUS:CONFIRMED\nEND:VEVENT\n`;
    }
    
    ics += 'END:VCALENDAR';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(ics);
  } catch (err) { res.status(500).send('Error'); }
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
