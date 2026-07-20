const express = require('express');
const router = express.Router();
const { getSettings, updateSettings, getBookings } = require('../database');
const { auth } = require('../middleware/auth');

// ===================== GOOGLE MAPS (free scraping) =====================
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

async function scrapeGoogleMaps(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow'
    });
    const html = await res.text();

    const data = { name: '', address: '', phone: '', website: '', rating: 0, total_reviews: 0, reviews: [], schedule: '' };

    const ldMatch = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        const item = ld['@type'] === 'ItemList' ? ld.itemListElement?.[0]?.item : ld;
        if (item) {
          data.name = item.name || '';
          data.address = item.address?.streetAddress || item.address?.addressLocality || '';
          data.phone = item.telephone || '';
          data.website = item.url || '';
          data.rating = item.aggregateRating?.ratingValue || 0;
          data.total_reviews = item.aggregateRating?.reviewCount || 0;
          if (item.openingHoursSpecification) {
            const days = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
            data.schedule = item.openingHoursSpecification.map(s => {
              const dayList = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek];
              const dayNames = dayList.map(d => {
                const idx = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(d.replace('http://schema.org/', '').replace('https://schema.org/', ''));
                return days[idx] || d;
              }).join(', ');
              return `${dayNames} ${s.opens}-${s.closes}`;
            }).join(' | ');
          }
          if (item.review) {
            data.reviews = item.review.slice(0, 5).map(r => ({
              author: r.author?.name || 'Anónimo',
              rating: r.reviewRating?.ratingValue || 5,
              text: r.reviewBody || '',
              time: r.datePublished || ''
            }));
          }
        }
      } catch {}
    }

    if (!data.name) data.name = extractNameFromUrl(url);
    if (!data.name) {
      const ogMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      if (ogMatch) data.name = ogMatch[1].replace(/ - Google Maps$/, '').trim();
    }
    if (!data.rating) {
      const ratingMatch = html.match(/(\d+\.\d+)\s*estrellas?/i) || html.match(/"ratingValue":\s*"?(\d+\.?\d*)/);
      if (ratingMatch) data.rating = parseFloat(ratingMatch[1]);
    }
    if (!data.total_reviews) {
      const reviewMatch = html.match(/(\d+)\s*reseñas?/i) || html.match(/"reviewCount":\s*(\d+)/);
      if (reviewMatch) data.total_reviews = parseInt(reviewMatch[1]);
    }

    return data;
  } catch { return null; }
}

router.post('/google-maps/save', auth, async (req, res) => {
  try {
    const { url, name, address, phone, website, schedule } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const coords = extractCoordsFromUrl(url);
    let scraped = await scrapeGoogleMaps(url);

    const mapData = {
      url,
      name: name || scraped?.name || extractNameFromUrl(url) || '',
      address: address || scraped?.address || '',
      phone: phone || scraped?.phone || '',
      website: website || scraped?.website || '',
      schedule: schedule || scraped?.schedule || '',
      rating: scraped?.rating || 0,
      total_reviews: scraped?.total_reviews || 0,
      lat: coords?.lat || 0,
      lng: coords?.lng || 0,
      embed_url: coords ? `https://maps.google.com/maps?q=${coords.lat},${coords.lng}&z=17&output=embed` : '',
      reviews_url: url.includes('/place/') ? `https://www.google.com/maps/place/?q=place_id:` : url,
      reviews: scraped?.reviews || [],
      saved_at: new Date().toISOString()
    };

    if (scraped?.reviews?.length) {
      const { getDb } = require('../firebase');
      const db = getDb();
      for (const r of scraped.reviews) {
        if (r.text && r.author) {
          const existing = await db.collection('users').doc(req.userId).collection('reviews')
            .where('source', '==', 'google_maps').where('author', '==', r.author).where('text', '==', r.text).limit(1).get();
          if (existing.empty) {
            await db.collection('users').doc(req.userId).collection('reviews').add({
              client_name: r.author,
              rating: r.rating,
              comment: r.text,
              source: 'google_maps',
              source_url: url,
              created_at: r.time || new Date().toISOString()
            });
          }
        }
      }
    }

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

// ===================== GOOGLE CALENDAR (ICS sync) =====================
function generateICS(bookings, businessName) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmtICSDate = (date, time) => {
    const [y, m, d] = date.split('-');
    const [h, min] = (time || '09:00').split(':');
    return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
  };

  let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Gestria//Reservas//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${businessName || 'Gestria'} - Reservas
X-WR-TIMEZONE:Europe/Madrid
`;

  for (const b of bookings) {
    const uid = b.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const dtStart = fmtICSDate(b.date, b.start_time);
    const dtEnd = fmtICSDate(b.date, b.end_time);
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    ics += `BEGIN:VEVENT
UID:${uid}@gestria
DTSTAMP:${now}
DTSTART:${dtStart}
DTEND:${dtEnd}
SUMMARY:${b.service_name || 'Reserva'} - ${b.client_name || 'Cliente'}
DESCRIPTION:Reserva en ${businessName || 'Gestria'}\\nServicio: ${b.service_name}\\nCliente: ${b.client_name}\\nEmpleado: ${b.employee_name}\\nEstado: ${b.status}
LOCATION:${businessName || ''}
STATUS:CONFIRMED
END:VEVENT
`;
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

router.get('/google-calendar/ics', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const bookings = await getBookings(req.userId);
    const today = new Date().toISOString().split('T')[0];
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled');
    const ics = generateICS(upcoming, settings.business_name);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gestria-reservas.ics"`);
    res.send(ics);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/google-calendar/status', auth, async (req, res) => {
  res.json({ connected: true, message: 'Sincronización disponible mediante enlaces y archivo .ics' });
});

module.exports = router;
