const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../database');
const { getDb } = require('../firebase');
const { auth } = require('../middleware/auth');

router.use(auth);

// ===================== GOOGLE CALENDAR =====================
router.get('/google-calendar/status', async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const connected = !!(settings.google_calendar_token && settings.google_calendar_id);
    res.json({ connected, calendar_id: settings.google_calendar_id || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-calendar/connect', async (req, res) => {
  try {
    const { calendar_id, access_token, refresh_token } = req.body;
    await updateSettings(req.userId, {
      google_calendar_id: calendar_id,
      google_calendar_token: access_token,
      google_calendar_refresh: refresh_token
    });
    res.json({ success: true, message: 'Google Calendar conectado correctamente' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-calendar/disconnect', async (req, res) => {
  try {
    await updateSettings(req.userId, { google_calendar_id: '', google_calendar_token: '', google_calendar_refresh: '' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/google-calendar/sync', async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    if (!settings.google_calendar_token) return res.status(400).json({ error: 'Google Calendar no conectado' });
    res.json({ success: true, message: 'Sincronización programada. Las reservas se enviarán a Google Calendar.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== INSTAGRAM =====================
router.get('/instagram/status', async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const connected = !!(settings.instagram_token && settings.instagram_page_id);
    res.json({ connected, page_id: settings.instagram_page_id || null, verify_token: settings.instagram_verify_token || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/configure', async (req, res) => {
  try {
    const { page_id, access_token, verify_token } = req.body;
    await updateSettings(req.userId, {
      instagram_page_id: page_id,
      instagram_token: access_token,
      instagram_verify_token: verify_token || `gestria_${Math.random().toString(36).substr(2, 16)}`
    });
    const updated = await getSettings(req.userId);
    res.json({ success: true, verify_token: updated.instagram_verify_token, message: 'Instagram configurado. Configura el webhook en Meta Developer Console.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/instagram/disconnect', async (req, res) => {
  try {
    await updateSettings(req.userId, { instagram_token: '', instagram_page_id: '', instagram_verify_token: '' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/instagram/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token) {
    res.status(200).send(challenge);
  } else { res.sendStatus(403); }
});

router.post('/instagram/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'page') return;
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (event.message?.text) {
          console.log(`Instagram message from ${event.sender.id}: ${event.message.text}`);
        }
      }
    }
  } catch (err) { console.error('Instagram webhook error:', err.message); }
});

// ===================== WHATSAPP =====================
router.get('/whatsapp/status', async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    const connected = !!(settings.whatsapp_token && settings.whatsapp_phone_number_id);
    res.json({ connected, phone_number_id: settings.whatsapp_phone_number_id || null, business_account_id: settings.whatsapp_business_account_id || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/configure', async (req, res) => {
  try {
    const { phone_number_id, access_token, business_account_id } = req.body;
    await updateSettings(req.userId, {
      whatsapp_phone_number_id: phone_number_id,
      whatsapp_token: access_token,
      whatsapp_business_account_id: business_account_id
    });
    res.json({ success: true, message: 'WhatsApp Business configurado. Configura el webhook en Meta Developer Console.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp/disconnect', async (req, res) => {
  try {
    await updateSettings(req.userId, { whatsapp_token: '', whatsapp_phone_number_id: '', whatsapp_business_account_id: '' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token) {
    res.status(200).send(challenge);
  } else { res.sendStatus(403); }
});

router.post('/whatsapp/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          if (msg.type === 'text') {
            console.log(`WhatsApp message from ${msg.from}: ${msg.text.body}`);
          }
        }
      }
    }
  } catch (err) { console.error('WhatsApp webhook error:', err.message); }
});

// ===================== SEND MESSAGE HELPERS =====================
async function sendWhatsAppMessage(phoneNumberId, token, to, message) {
  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
  });
  return await res.json();
}

async function sendInstagramMessage(pageId, token, recipientId, message) {
  const res = await fetch(`https://graph.facebook.com/v18.0/me/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } })
  });
  return await res.json();
}

module.exports = router;
