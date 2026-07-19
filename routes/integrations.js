const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');
const { auth } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { SECRET } = require('../middleware/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://gestria-git-main-yosoyanaspros-projects.vercel.app/api/integrations/google-calendar/callback';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ===================== GOOGLE CALENDAR OAuth =====================
router.get('/google-calendar/auth', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).send('Token requerido');
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).send(`
      <html><head><title>Error de configuración</title><style>body{font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f9fafb;margin:0}.card{background:white;padding:40px;border-radius:16px;max-width:480px;box-shadow:0 4px 12px rgba(0,0,0,.1);text-align:center}h2{color:#1f2937;margin-bottom:12px}p{color:#6b7280;line-height:1.6}.code{background:#f3f4f6;padding:12px;border-radius:8px;font-size:13px;text-align:left;margin:16px 0;font-family:monospace}.btn{display:inline-block;margin-top:16px;padding:10px 24px;background:#4F46E5;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;text-decoration:none}</style></head><body><div class="card"><h2>⚠️ Credenciales no configuradas</h2><p>Las variables de entorno de Google no están configuradas en Vercel.</p><div class="code">GOOGLE_CLIENT_ID<br>GOOGLE_CLIENT_SECRET<br>GOOGLE_REDIRECT_URI</div><p>Ve a <strong>Vercel → Settings → Environment Variables</strong> y añade estas variables con los valores de tu proyecto de Google Cloud Console.</p><p style="font-size:13px;margin-top:12px">Asegúrate de que en Google Cloud Console:<br>1. La OAuth App está en modo "Producción"<br>2. El redirect URI está verificado</p><a class="btn" href="/#/integrations">← Volver a Integraciones</a></div></body></html>
    `);
  }
  try {
    jwt.verify(token, SECRET);
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar')}&state=${encodeURIComponent(token)}&access_type=offline&prompt=consent`;
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
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
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
          client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: settings.google_calendar_refresh, grant_type: 'refresh_token'
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

// ===================== GOOGLE MAPS =====================
function extractPlaceId(url) {
  const patterns = [
    [/place_id[:=]([A-Za-z0-9_-]+)/i],
    [/!1s([A-Za-z0-9_-]+)!/],
    [/maps\/place\/[^/]*\/@[^/]*\/data=.*?!1s([A-Za-z0-9_-]+)/i],
    [/0x[0-9a-f]+:0x[0-9a-f]+.*?\/place\/([^/@]+)/i]
  ];
  for (const [re] of patterns) {
    const m = url.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

router.post('/google-maps/fetch', auth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    if (!GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY no configurada en Vercel. Añádela en Settings → Environment Variables.' });
    }

    let placeId = extractPlaceId(url);

    if (!placeId) {
      const textSearchRes = await fetch(`https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(url)}&inputtype=textquery&fields=place_id&key=${GOOGLE_MAPS_API_KEY}`);
      const textData = await textSearchRes.json();
      if (textData.candidates?.length) {
        placeId = textData.candidates[0].place_id;
      }
    }

    if (!placeId) return res.status(404).json({ error: 'No se pudo encontrar el lugar. Asegúrate de que la URL sea válida.' });

    const detailsRes = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,formatted_phone_number,website,rating,user_ratings_total,url,photos,reviews,opening_hours,geometry&reviews_sort=most_relevant&key=${GOOGLE_MAPS_API_KEY}`);
    const details = await detailsRes.json();

    if (details.status !== 'OK') return res.status(404).json({ error: `Error de Google Places: ${details.status}` });

    const d = details.result;
    let photoUrl = null;
    if (d.photos?.length) {
      photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${d.photos[0].photo_reference}&key=${GOOGLE_MAPS_API_KEY}`;
    }

    const mapData = {
      place_id: placeId,
      name: d.name,
      address: d.formatted_address,
      phone: d.formatted_phone_number || '',
      website: d.website || '',
      rating: d.rating || 0,
      total_reviews: d.user_ratings_total || 0,
      photo_url: photoUrl,
      url: d.url,
      lat: d.geometry?.location?.lat || 0,
      lng: d.geometry?.location?.lng || 0,
      opening_hours: d.opening_hours?.weekday_text || [],
      reviews: (d.reviews || []).slice(0, 5).map(r => ({
        author: r.author_name,
        rating: r.rating,
        text: r.text || '',
        time: r.relative_time_description || '',
        profile_photo: r.profile_photo_url || ''
      })),
      fetched_at: new Date().toISOString()
    };

    await updateSettings(req.userId, {
      google_maps_url: url,
      google_maps_data: JSON.stringify(mapData)
    });

    res.json({ success: true, data: mapData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-maps/status', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    let data = null;
    if (settings.google_maps_data) {
      try { data = JSON.parse(settings.google_maps_data); } catch {}
    }
    res.json({
      connected: !!data,
      url: settings.google_maps_url || null,
      data
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-maps/disconnect', auth, async (req, res) => {
  try {
    await updateSettings(req.userId, { google_maps_url: '', google_maps_data: '' });
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
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token']) res.status(200).send(req.query['hub.challenge']);
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
