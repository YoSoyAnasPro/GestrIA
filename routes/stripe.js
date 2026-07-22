const express = require('express');
const router = express.Router();
const { getSettings, getBookings } = require('../database');
const { auth } = require('../middleware/auth');

router.post('/create-checkout', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    if (!settings.stripe_secret_key) return res.status(400).json({ error: 'Stripe no está configurado. Ve a Configuración para añadir tus claves.' });
    const stripe = require('stripe')(settings.stripe_secret_key);
    const { booking_id, amount, currency, description, customer_email, success_url, cancel_url } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Importe no válido' });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: customer_email || undefined,
      line_items: [{ price_data: { currency: currency || 'eur', product_data: { name: description || 'Señal de reserva', metadata: { booking_id: booking_id || '' } }, unit_amount: Math.round(amount * 100) }, quantity: 1 }],
      success_url: success_url || `${req.headers.origin || 'https://gestria.vercel.app'}/app`,
      cancel_url: cancel_url || `${req.headers.origin || 'https://gestria.vercel.app'}/app`,
      metadata: { booking_id: booking_id || '', user_id: req.userId }
    });
    res.json({ url: session.url, session_id: session.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const { getDb } = require('../firebase');
    const db = getDb();
    const sig = req.headers['stripe-signature'];
    const body = req.body;
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    if (endpointSecret) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      try { event = stripe.webhooks.constructEvent(body, sig, endpointSecret); }
      catch { return res.sendStatus(400); }
    } else {
      event = typeof body === 'string' ? JSON.parse(body) : body;
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const metadata = session.metadata || {};
      if (metadata.booking_id && metadata.user_id) {
        await db.collection('users').doc(metadata.user_id).collection('bookings').doc(metadata.booking_id).update({
          payment_status: 'paid',
          payment_amount: (session.amount_total || 0) / 100,
          payment_method: 'stripe',
          payment_session_id: session.id
        });
      }
    }
    res.json({ received: true });
  } catch (err) { res.sendStatus(200); }
});

router.get('/config', auth, async (req, res) => {
  try {
    const settings = await getSettings(req.userId);
    res.json({
      configured: !!(settings.stripe_secret_key && settings.stripe_publishable_key),
      deposit_enabled: settings.deposit_enabled || false,
      deposit_type: settings.deposit_type || 'fixed',
      deposit_amount: settings.deposit_amount || 0,
      stripe_publishable_key: settings.stripe_publishable_key || ''
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
