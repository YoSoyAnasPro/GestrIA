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
    let cleanUrl = url.trim();
    // Normalize URL - ensure it starts with https://
    if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
    // Extract CID or place ID from various Google Maps URL formats
    const cidMatch = cleanUrl.match(/cid=(\d+)/);
    const placeIdMatch = cleanUrl.match(/ChIJ[A-Za-z0-9_-]+/);
    // For short URLs or place IDs, try the full URL
    cleanUrl = cleanUrl.split('?')[0].split('&')[0];
    
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) {
      console.log('[GoogleMaps] HTTP error:', res.status, res.statusText);
      return null;
    }
    
    const html = await res.text();
    
    // Check if Google blocked the request (consent page, captcha, etc.)
    if (html.includes('consent.google') || html.includes('captcha') || html.length < 1000) {
      console.log('[GoogleMaps] Request blocked by Google (consent/captcha)');
      return null;
    }
    const html = await res.text();
    const data = { name: '', address: '', phone: '', website: '', rating: 0, total_reviews: 0, reviews: [], schedule: '' };

    // Decode unicode escapes (\\u003c -> <, etc)
    const decoded = html.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&').replace(/\\u003d/g, '=');

    // Extract from raw HTML/decoded text patterns that Google Maps embeds
    // Name: look for og:title or place name patterns
    const ogTitle = decoded.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
    if (ogTitle) data.name = ogTitle[1].replace(/\s*[-–]\s*Google Maps?\s*$/i, '').replace(/\s*[-–]\s*Google\s*$/i, '').trim();
    if (!data.name) data.name = extractNameFromUrl(url);

    // Address: look for og:description or streetAddress in decoded content
    const ogDesc = decoded.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
    if (ogDesc && !data.address) {
      // og:description often contains address-like info
      const desc = ogDesc[1];
      if (desc.length < 200 && !desc.includes('Google Maps')) data.address = desc.trim();
    }
    // Try streetAddress from JSON-LD or raw text
    const streetAddr = decoded.match(/"streetAddress"\s*:\s*"([^"]+)"/);
    if (streetAddr) data.address = streetAddr[1];
    if (!data.address) {
      // Try address pattern from the page text
      const addrPattern = decoded.match(/(?:Dirección|Address|Ubicación)[:\s]*([^\n"<]{5,120})/i);
      if (addrPattern) data.address = addrPattern[1].trim();
    }

    // Phone: try multiple patterns
    const phonePatterns = [
      /"telephone"\s*:\s*"([^"]+)"/,
      /(?:Teléfono|Phone|Tel|Llamar)[:\s]*([+]?[\d\s\-\(\)]{7,20})/i,
      /href="tel:([^"]+)"/,
      /\+34[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/,
      /\+34[\s-]?\d{2}[\s-]?\d{4}[\s-]?\d{3}/
    ];
    for (const p of phonePatterns) {
      const m = decoded.match(p);
      if (m) { data.phone = (m[1] || m[0]).trim(); break; }
    }

    // Website
    const webPatterns = [
      /"url"\s*:\s*"(https?:\/\/(?!.*google|.*gstatic|.*maps)[^"]+)"/,
      /<meta[^>]*property="og:url"[^>]*content="(https?:\/\/(?!.*google)[^"]+)"/i,
      /(?:Web|Sitio|Página oficial)[:\s]*(https?:\/\/[^\s<"]+)/i
    ];
    for (const p of webPatterns) {
      const m = decoded.match(p);
      if (m) { data.website = m[1]; break; }
    }

    // Rating from multiple sources
    const ratingPatterns = [
      /"ratingValue"\s*:\s*"?(\d+\.?\d*)/,
      /(\d+\.\d+)\s*(?:estrellas?|stars?)/i,
      /aria-label="[^"]*?(\d+\.?\d*)\s*(?:estrella|star)/i
    ];
    for (const p of ratingPatterns) {
      const m = decoded.match(p);
      if (m) { data.rating = parseFloat(m[1]); break; }
    }

    // Total reviews
    const reviewCountPatterns = [
      /"reviewCount"\s*:\s*(\d+)/,
      /(\d[\d.,]*)\s*reseñas?/i,
      /(\d[\d.,]*)\s*reviews?/i
    ];
    for (const p of reviewCountPatterns) {
      const m = decoded.match(p);
      if (m) { data.total_reviews = parseInt(m[1].replace(/[.,]/g, '')); break; }
    }

    // Schedule from JSON-LD or text
    const schedMatch = decoded.match(/"openingHoursSpecification"\s*:\s*\[([\s\S]*?)\]/);
    if (schedMatch) {
      try {
        const specs = JSON.parse('[' + schedMatch[1] + ']');
        const days = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
        data.schedule = specs.map(s => {
          const dayList = Array.isArray(s.dayOfWeek) ? s.dayOfWeek : [s.dayOfWeek];
          const dayNames = (dayList || []).map(d => {
            const clean = String(d).replace(/https?:\/\/schema\.org\//, '');
            const idx = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].indexOf(clean);
            return days[idx] || clean;
          }).join(', ');
          return `${dayNames} ${s.opens || ''}-${s.closes || ''}`;
        }).join(' | ');
      } catch {}
    }
    if (!data.schedule) {
      const schedText = decoded.match(/(?:Horario|Hours)[:\s]*([^<"]{10,200})/i);
      if (schedText) data.schedule = schedText[1].trim();
    }

    // Reviews from JSON-LD
    const reviewSection = decoded.match(/"review"\s*:\s*\[([\s\S]*?)\]\s*[,}]/);
    if (reviewSection) {
      try {
        const reviews = JSON.parse('[' + reviewSection[1] + ']');
        data.reviews = reviews.slice(0, 5).map(r => ({
          author: r.author?.name || r.author || 'Anónimo',
          rating: r.reviewRating?.ratingValue || r.rating || 5,
          text: r.reviewBody || r.text || '',
          time: r.datePublished || ''
        }));
      } catch {}
    }

    // Fallback: extract from embedded HTML text
    if (!data.reviews.length) {
      const authorMatches = [...decoded.matchAll(/class="[^"]*(?:review-author|user-name|WMbnNe)[^"]*"[^>]*>([^<]+)</gi)];
      const textMatches = [...decoded.matchAll(/class="[^"]*(?:review-text|wiI7pe|MJSp7b)[^"]*"[^>]*>([^<]{10,500})</gi)];
      const ratingMatches = [...decoded.matchAll(/class="[^"]*(?:review-star|kvMYJc)[^"]*"[^>]*aria-label="(\d)/gi)];
      const count = Math.min(authorMatches.length, textMatches.length, ratingMatches.length, 5);
      for (let i = 0; i < count; i++) {
        data.reviews.push({
          author: authorMatches[i][1].trim(),
          rating: parseInt(ratingMatches[i][1]) || 5,
          text: textMatches[i][1].trim(),
          time: ''
        });
      }
    }

    return data;
  } catch (e) { return null; }
}

router.post('/google-maps/save', auth, async (req, res) => {
  try {
    const { url, name, address, phone, website, schedule } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    let scraped = null;
    let scrapeError = null;
    try {
      scraped = await scrapeGoogleMaps(url);
    } catch (e) {
      scrapeError = e.message;
      console.log('[GoogleMaps] Scrape error:', e.message);
    }

    const coords = scraped ? extractCoordsFromUrl(url) : null;
    const hasAnyManualField = name || address || phone || website || schedule;
    const hasScrapedData = scraped && (scraped.name || scraped.address || scraped.phone);

    // Build map data - use manual fields first, fallback to scraped
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

    // If no coords from URL, try to build embed from name
    if (!mapData.embed_url && mapData.name) {
      const encoded = encodeURIComponent(mapData.name);
      mapData.embed_url = `https://maps.google.com/maps?q=${encoded}&z=15&output=embed`;
    }

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

    const message = hasScrapedData 
      ? `Negocio encontrado: ${mapData.name || url}` 
      : hasAnyManualField 
        ? 'Datos guardados correctamente' 
        : 'URL guardada. Rellena los datos manualmente si la información no se ha detectado automáticamente.';

    res.json({ success: true, data: mapData, message, scraped: !!hasScrapedData });
  } catch (err) { 
    console.error('[GoogleMaps] Save error:', err);
    res.status(500).json({ error: err.message }); 
  }
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

// ICS endpoint - no auth required (uses token in query for Vercel)
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

// Get all bookings as Google Calendar links
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
    res.json({
      connected,
      page_id: settings.instagram_page_id || null,
      verify_token: settings.instagram_verify_token || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/configure', auth, async (req, res) => {
  try {
    const { page_id, access_token } = req.body;
    if (!page_id || !access_token) return res.status(400).json({ error: 'Page ID y Access Token requeridos' });
    const verifyToken = 'gestria_ig_' + Math.random().toString(36).substr(2, 12);
    await updateSettings(req.userId, {
      instagram_page_id: page_id,
      instagram_token: access_token,
      instagram_verify_token: verifyToken
    });
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
    res.json({
      connected,
      phone_number_id: settings.whatsapp_phone_number_id || null,
      business_account_id: settings.whatsapp_business_account_id || null
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/configure', auth, async (req, res) => {
  try {
    const { phone_number_id, business_account_id, access_token } = req.body;
    if (!phone_number_id || !access_token) return res.status(400).json({ error: 'Phone Number ID y Access Token requeridos' });
    await updateSettings(req.userId, {
      whatsapp_phone_number_id: phone_number_id,
      whatsapp_business_account_id: business_account_id || '',
      whatsapp_token: access_token
    });
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
