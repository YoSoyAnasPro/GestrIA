const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');
const { auth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://gestria-git-main-yosoyanaspros-projects.vercel.app/api/integrations/google-calendar/callback';

// ===================== GOOGLE CALENDAR OAuth (sin auth middleware) =====================
router.get('/google-calendar/auth', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).send('Token requerido');
  try {
    const decoded = jwt.verify(token, SECRET);
    const state = token;
    const scopes = ['https://www.googleapis.com/auth/calendar'];
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&state=${encodeURIComponent(state)}&access_type=offline&prompt=consent`;
    res.redirect(url);
  } catch (err) {
    res.status(401).send('Token inválido');
  }
});

router.get('/google-calendar/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = REDIRECT_URI.replace('/api/integrations/google-calendar/callback', '');
  if (error) return res.redirect(`${frontendUrl}/#/integrations?gcal=error&msg=${error}`);
  if (!code || !state) return res.redirect(`${frontendUrl}/#/integrations?gcal=error&msg=missing_params`);
  try {
    const decoded = jwt.verify(state, SECRET);
    const userId = decoded.userId;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) return res.redirect(`${frontendUrl}/#/integrations?gcal=error&msg=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    const calRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?primary', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const calData = await calRes.json();
    const calendarId = calData.id || calData.items?.[0]?.id || 'primary';
    await updateSettings(userId, {
      google_calendar_token: tokenData.access_token,
      google_calendar_refresh: tokenData.refresh_token || '',
      google_calendar_id: calendarId,
      google_calendar_expiry: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0
    });
    res.redirect(`${frontendUrl}/#/integrations?gcal=success`);
  } catch (err) {
    res.redirect(`${frontendUrl}/#/integrations?gcal=error&msg=${encodeURIComponent(err.message)}`);
  }
});

router.post('/google-calendar/sync', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    if (!settings.google_calendar_token) return res.status(400).json({ error: 'Google Calendar no conectado' });
    let accessToken = settings.google_calendar_token;
    if (settings.google_calendar_expiry && Date.now() > settings.google_calendar_expiry && settings.google_calendar_refresh) {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: settings.google_calendar_refresh,
          grant_type: 'refresh_token'
        })
      });
      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        accessToken = tokenData.access_token;
        await updateSettings(req.userId, {
          google_calendar_token: accessToken,
          google_calendar_expiry: Date.now() + (tokenData.expires_in || 3600) * 1000
        });
      }
    }
    const { getBookings } = require('../database');
    const bookings = await getBookings(req.userId);
    const today = new Date().toISOString().split('T')[0];
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled');
    let created = 0;
    for (const b of upcoming.slice(0, 20)) {
      const event = {
        summary: `${b.service_name} - ${b.client_name}`,
        description: `Reserva en Gestria\nServicio: ${b.service_name}\nCliente: ${b.client_name}\nEmpleado: ${b.employee_name}`,
        start: { date: b.date, time: b.start_time, timeZone: 'Europe/Madrid' },
        end: { date: b.date, time: b.end_time, timeZone: 'Europe/Madrid' },
        colorId: '6'
      };
      const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.google_calendar_id)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      });
      if (calRes.ok) created++;
    }
    res.json({ success: true, message: `${created} eventos sincronizados con Google Calendar` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-calendar/status', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const connected = !!(settings.google_calendar_token && settings.google_calendar_id);
    res.json({ connected, calendar_id: settings.google_calendar_id || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-calendar/disconnect', auth, async (req, res) => {
  try {
    await updateSettings(req.userId, { google_calendar_id: '', google_calendar_token: '', google_calendar_refresh: '', google_calendar_expiry: 0 });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== INSTAGRAM =====================
router.get('/instagram/status', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    res.json({ connected: !!(settings.instagram_token && settings.instagram_page_id), page_id: settings.instagram_page_id || null, verify_token: settings.instagram_verify_token || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/configure', auth, async (req, res) => {
  try {
    const { page_id, access_token } = req.body;
    const verify_token = `gestria_${Math.random().toString(36).substr(2, 16)}`;
    await updateSettings(req.userId, { instagram_page_id: page_id, instagram_token: access_token, instagram_verify_token: verify_token });
    res.json({ success: true, verify_token });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/disconnect', auth, async (req, res) => {
  try { await updateSettings(req.userId, { instagram_token: '', instagram_page_id: '', instagram_verify_token: '' }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token) res.status(200).send(challenge);
  else res.sendStatus(403);
});

router.post('/instagram/webhook', (req, res) => { res.sendStatus(200); });

// ===================== WHATSAPP =====================
router.get('/whatsapp/status', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    res.json({ connected: !!(settings.whatsapp_token && settings.whatsapp_phone_number_id), phone_number_id: settings.whatsapp_phone_number_id || null, business_account_id: settings.whatsapp_business_account_id || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/configure', auth, async (req, res) => {
  try {
    const { phone_number_id, access_token, business_account_id } = req.body;
    await updateSettings(req.userId, { whatsapp_phone_number_id: phone_number_id, whatsapp_token: access_token, whatsapp_business_account_id: business_account_id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/disconnect', auth, async (req, res) => {
  try { await updateSettings(req.userId, { whatsapp_token: '', whatsapp_phone_number_id: '', whatsapp_business_account_id: '' }); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/whatsapp/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token']) res.status(200).send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

router.post('/whatsapp/webhook', (req, res) => { res.sendStatus(200); });

module.exports = router;
