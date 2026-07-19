const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');
const { auth } = require('../middleware/auth');

// ===================== GOOGLE MAPS (free, no API) =====================
function extractCoordsFromUrl(url) {
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /q=(-?\d+\.\d+),(-?\d+\.\d+)/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}

function extractNameFromUrl(url) {
  const m = url.match(/maps\/place\/([^/@]+)/);
  if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
  const q = url.match(/[?&]q=([^&]+)/);
  if (q) return decodeURIComponent(q[1].replace(/\+/g, ' '));
  return '';
}

router.post('/google-maps/save', auth, async (req, res) => {
  try {
    const { url, name, address, phone, website, schedule } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const coords = extractCoordsFromUrl(url);
    const autoName = extractNameFromUrl(url);

    const mapData = {
      url,
      name: name || autoName || '',
      address: address || '',
      phone: phone || '',
      website: website || '',
      schedule: schedule || '',
      lat: coords?.lat || 0,
      lng: coords?.lng || 0,
      embed_url: coords ? `https://maps.google.com/maps?q=${coords.lat},${coords.lng}&z=17&output=embed` : '',
      reviews_url: url.includes('/place/') ? url.split('/place/')[0] + '/place/' + encodeURIComponent(name || autoName || 'mi negocio') + '/reviews' : url,
      saved_at: new Date().toISOString()
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
    res.json({ connected: !!data, url: settings.google_maps_url || null, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-maps/disconnect', auth, async (req, res) => {
  try {
    await updateSettings(req.userId, { google_maps_url: '', google_maps_data: '' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== GOOGLE CALENDAR (free, no API) =====================
router.get('/google-calendar/link', auth, (req, res) => {
  try {
    const { title, start, end, description, location } = req.query;
    if (!title || !start) return res.status(400).json({ error: 'Título y fecha requeridos' });

    const fmtDate = (d) => {
      const dt = new Date(d);
      return dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${fmtDate(start)}/${fmtDate(end || start)}`,
      details: description || '',
      location: location || ''
    });

    res.json({ url: `https://calendar.google.com/calendar/render?${params.toString()}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-calendar/status', auth, async (req, res) => {
  res.json({ connected: true, message: 'Usa los enlaces "Añadir a Google Calendar" en cada reserva' });
});

module.exports = router;
