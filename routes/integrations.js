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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow'
    });
    const html = await res.text();

    const data = { name: '', address: '', phone: '', website: '', rating: 0, total_reviews: 0, reviews: [], schedule: '' };

    // Try JSON-LD first
    const ldMatches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const ldMatch of ldMatches) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        const items = ld['@type'] === 'ItemList' ? (ld.itemListElement || []).map(i => i.item).filter(Boolean) : [ld];
        for (const item of items) {
          if (!item || !item.name) continue;
          if (!data.name) data.name = item.name || '';
          if (!data.address) data.address = item.address?.streetAddress || item.address?.addressLocality || item.address?.addressRegion || '';
          if (!data.phone) data.phone = item.telephone || '';
          if (!data.website) data.website = item.url || '';
          if (!data.rating && item.aggregateRating) data.rating = parseFloat(item.aggregateRating.ratingValue) || 0;
          if (!data.total_reviews && item.aggregateRating) data.total_reviews = parseInt(item.aggregateRating.reviewCount) || 0;
          if (!data.schedule && item.openingHoursSpecification) {
            const days = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
            data.schedule = item.openingHoursSpecification.map(s => {
              const dayList = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek];
              const dayNames = dayList.map(d => {
                const clean = d.replace(/https?:\/\/schema\.org\//, '');
                const idx = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(clean);
                return days[idx] || clean;
              }).join(', ');
              return `${dayNames} ${s.opens}-${s.closes}`;
            }).join(' | ');
          }
          if (!data.reviews.length && item.review) {
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

    // Fallbacks from HTML
    if (!data.name) data.name = extractNameFromUrl(url);
    if (!data.name) {
      const ogMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
      if (ogMatch) data.name = ogMatch[1].replace(/ - Google Maps$/, '').trim();
    }

    // Address from meta or text patterns
    if (!data.address) {
      const addrMatch = html.match(/"streetAddress"\s*:\s*"([^"]+)"/);
      if (addrMatch) data.address = addrMatch[1];
    }
    if (!data.address) {
      const addrMeta = html.match(/<meta property="og:description" content="([^"]+)"/);
      if (addrMeta && addrMeta[1].length < 200) data.address = addrMeta[1];
    }

    // Phone from text patterns
    if (!data.phone) {
      const phoneMatch = html.match(/"telephone"\s*:\s*"([^"]+)"/) || html.match(/\+?\d{1,4}[\s-]?\(?\d{1,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/);
      if (phoneMatch) data.phone = phoneMatch[1] || phoneMatch[0];
    }

    // Website from patterns
    if (!data.website) {
      const webMatch = html.match(/"url"\s*:\s*"(https?:\/\/(?!.*google)[^"]+)"/);
      if (webMatch) data.website = webMatch[1];
    }

    // Rating fallback
    if (!data.rating) {
      const ratingMatch = html.match(/(\d+\.\d+)\s*(?:estrellas?|stars?)/i) || html.match(/"ratingValue"\s*:\s*"?(\d+\.?\d*)/);
      if (ratingMatch) data.rating = parseFloat(ratingMatch[1]);
    }
    if (!data.total_reviews) {
      const reviewMatch = html.match(/(\d[\d.,]*)\s*reseñas?/i) || html.match(/"reviewCount"\s*:\s*(\d+)/);
      if (reviewMatch) data.total_reviews = parseInt(reviewMatch[1].replace(/[.,]/g, ''));
    }

    // Schedule fallback from text
    if (!data.schedule) {
      const schedMatch = html.match(/Horario[:\s]*([^<"]{10,100})/i);
      if (schedMatch) data.schedule = schedMatch[1].trim();
    }

    // Reviews fallback - extract from HTML text
    if (!data.reviews.length) {
      const reviewBlocks = [...html.matchAll(/class="[^"]*review[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?(?:class="[^"]*star[^"]*"|(\d)\s*(?:estrella|star))/gi)];
      reviewBlocks.slice(0, 5).forEach(rb => {
        if (rb[1] && rb[1].length > 2 && rb[1].length < 200) {
          data.reviews.push({
            author: 'Cliente',
            rating: parseInt(rb[2]) || 5,
            text: rb[1].trim(),
            time: ''
          });
        }
      });
    }

    return data;
  } catch (e) { return null; }
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
      reviews_url: url,
      reviews: scraped?.reviews || [],
      saved_at: new Date().toISOString()
    };

    // Import scraped reviews to Firestore
    if (scraped?.reviews?.length) {
      const { getDb } = require('../firebase');
      const db = getDb();
      for (const r of scraped.reviews) {
        if (r.text && r.author && r.author !== 'Cliente') {
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

// ===================== GOOGLE CALENDAR =====================
function fmtGoogleCalDate(date, time) {
  const dt = new Date(`${date}T${time || '09:00'}:00`);
  return dt.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

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

// Generate Google Calendar link for a single booking
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

// ICS subscription endpoint (webcal sync)
router.get('/google-calendar/ics', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const bookings = await getBookings(req.userId);
    const today = new Date().toISOString().split('T')[0];
    const upcoming = bookings.filter(b => b.date >= today && b.status !== 'cancelled');
    const ics = generateICS(upcoming, settings.business_name);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="gestria-reservas.ics"');
    res.send(ics);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all bookings as Google Calendar links
router.get('/google-calendar/bulk', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const bookings = await getBookings(req.userId);
    const today = new Date().toISOString().split('T')[0];
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

module.exports = router;
