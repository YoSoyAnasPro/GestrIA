const express = require('express');
const router = express.Router();
const { getSettings, getBookings } = require('../database');
const { auth } = require('../middleware/auth');
const { getStripeClient } = require('../lib/stripe-client');
const {
  recordStripeEvent,
  isStripeEventProcessed,
  getSubscriptionByStripeId,
  getSubscriptionByUserId,
  createSubscription,
  updateSubscription,
  updateSubscriptionByStripeId,
  updateUser,
} = require('../database');

// ===================== DEPOSIT CHECKOUT (existing) =====================
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

// ===================== STRIPE CONFIG =====================
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

// ===================== WEBHOOK HANDLER (subscriptions + deposits) =====================
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      console.error('[Stripe Webhook] No Stripe client available');
      return res.sendStatus(500);
    }

    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotency check
    const alreadyProcessed = await isStripeEventProcessed(event.id);
    if (alreadyProcessed) {
      return res.json({ received: true, message: 'Event already processed' });
    }

    await recordStripeEvent(event.id, event.type);

    const { getDb } = require('../firebase');
    const db = getDb();

    switch (event.type) {
      // ===================== SUBSCRIPTION LIFECYCLE =====================
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;
        if (userId) {
          const price = subscription.items?.data?.[0]?.price;
          await createSubscription(userId, {
            stripe_subscription_id: subscription.id,
            stripe_customer_id: subscription.customer,
            stripe_price_id: price?.id || null,
            status: subscription.status,
            plan_id: subscription.metadata?.plan || 'pro',
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
            trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          });
          await updateUser(userId, {
            stripe_customer_id: subscription.customer,
            subscription_status: subscription.status,
            subscription_plan: subscription.metadata?.plan || 'pro',
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;
        if (userId) {
          const existing = await getSubscriptionByStripeId(subscription.id);
          const price = subscription.items?.data?.[0]?.price;
          const updateData = {
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
            trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
            stripe_price_id: price?.id || existing?.stripe_price_id || null,
          };

          if (existing) {
            await updateSubscription(existing.id, updateData);
          } else {
            await createSubscription(userId, {
              ...updateData,
              stripe_subscription_id: subscription.id,
              stripe_customer_id: subscription.customer,
              plan_id: subscription.metadata?.plan || 'pro',
            });
          }

          await updateUser(userId, {
            subscription_status: subscription.status,
            subscription_plan: subscription.metadata?.plan || 'pro',
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.user_id;
        if (userId) {
          const existing = await getSubscriptionByStripeId(subscription.id);
          if (existing) {
            await updateSubscription(existing.id, {
              status: 'canceled',
              canceled_at: new Date().toISOString(),
            });
          }
          await updateUser(userId, {
            subscription_status: 'canceled',
            subscription_plan: null,
          });
        }
        break;
      }

      // ===================== INVOICE EVENTS =====================
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (subscriptionId) {
          const existing = await getSubscriptionByStripeId(subscriptionId);
          if (existing) {
            const paymentIntent = invoice.payment_intent
              ? await stripe.paymentIntents.retrieve(invoice.payment_intent)
              : null;
            const pm = paymentIntent?.payment_method
              ? await stripe.paymentMethods.retrieve(paymentIntent.payment_method)
              : null;

            await updateSubscription(existing.id, {
              last_payment_status: 'succeeded',
              last_invoice_id: invoice.id,
              last_invoice_amount: invoice.amount_paid,
              last_invoice_date: new Date().toISOString(),
              failed_payment_count: 0,
              payment_method_brand: pm?.card?.brand || existing.payment_method_brand,
              payment_method_last4: pm?.card?.last4 || existing.payment_method_last4,
              payment_method_type: pm?.type || existing.payment_method_type,
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (subscriptionId) {
          const existing = await getSubscriptionByStripeId(subscriptionId);
          if (existing) {
            const newFailedCount = (existing.failed_payment_count || 0) + 1;
            await updateSubscription(existing.id, {
              last_payment_status: 'failed',
              last_invoice_id: invoice.id,
              last_invoice_amount: invoice.amount_paid,
              last_invoice_date: new Date().toISOString(),
              failed_payment_count: newFailedCount,
            });
          }
        }
        break;
      }

      case 'invoice.payment_action_required': {
        // 3D Secure or similar action required
        const invoice = event.data.object;
        console.log('[Stripe Webhook] Payment action required for invoice:', invoice.id);
        break;
      }

      // ===================== DEPOSIT PAYMENTS (existing flow) =====================
      case 'checkout.session.completed': {
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
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Stripe Webhook] Error:', err.message);
    res.sendStatus(200);
  }
});

module.exports = router;
