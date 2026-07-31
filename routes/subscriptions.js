const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getStripeClient } = require('../lib/stripe-client');
const {
  getUserById,
  getOrCreateStripeCustomer,
  getSubscriptionByUserId,
  createSubscription,
  updateSubscription,
  updateSubscriptionByStripeId,
  recordStripeEvent,
  isStripeEventProcessed,
} = require('../database');

const APP_URL = process.env.APP_URL || 'https://gestria.vercel.app';

// ===================== GET SUBSCRIPTION STATUS =====================
router.get('/status', auth, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const subscription = await getSubscriptionByUserId(req.userId);
    if (!subscription) {
      return res.json({
        has_subscription: false,
        status: 'inactive',
        plan: null,
      });
    }

    res.json({
      has_subscription: true,
      status: subscription.status,
      plan: subscription.plan_id,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      canceled_at: subscription.canceled_at,
      payment_method_brand: subscription.payment_method_brand || null,
      payment_method_last4: subscription.payment_method_last4 || null,
      payment_method_type: subscription.payment_method_type || null,
      last_payment_status: subscription.last_payment_status || null,
      last_invoice_amount: subscription.last_invoice_amount || null,
      last_invoice_date: subscription.last_invoice_date || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== CREATE CHECKOUT SESSION =====================
router.post('/checkout', auth, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe no está configurado en el servidor' });

    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
    if (!priceId) return res.status(500).json({ error: 'Plan de precios no configurado' });

    let customerId = user.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.business_name || user.name,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await require('../database').updateUser(user.id, { stripe_customer_id: customerId });
    }

    const existingSub = await getSubscriptionByUserId(req.userId);
    if (existingSub && ['active', 'trialing', 'past_due'].includes(existingSub.status)) {
      return res.status(400).json({ error: 'Ya tienes una suscripción activa. Gestiónala desde la configuración.' });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/app?subscription=success`,
      cancel_url: `${APP_URL}/app?subscription=cancelled`,
      metadata: { user_id: user.id },
      subscription_data: {
        metadata: { user_id: user.id, plan: 'pro' },
        trial_period_days: 0,
      },
      payment_method_types: ['card', 'sepa_debit'],
      billing_address_collection: 'auto',
      tax_id_collection: { enabled: false },
    });

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[Subscription] Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================== CREATE CUSTOMER PORTAL SESSION =====================
router.post('/portal', auth, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe no está configurado en el servidor' });

    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'No hay cliente de Stripe asociado. Suscríbete primero.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${APP_URL}/app#/subscription`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Subscription] Portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================== REACTIVATE SUBSCRIPTION =====================
router.post('/reactivate', auth, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe no está configurado' });

    const subscription = await getSubscriptionByUserId(req.userId);
    if (!subscription) return res.status(404).json({ error: 'No se encontró suscripción' });

    if (subscription.status !== 'canceled' && subscription.status !== 'unpaid') {
      return res.status(400).json({ error: 'La suscripción no está cancelada o impagada' });
    }

    if (!subscription.stripe_subscription_id) {
      return res.status(400).json({ error: 'No hay ID de suscripción en Stripe' });
    }

    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: false,
      proration_behavior: 'create_prorations',
    });

    await updateSubscription(subscription.id, {
      status: updated.status,
      cancel_at_period_end: false,
      canceled_at: null,
    });

    res.json({ success: true, status: updated.status });
  } catch (err) {
    console.error('[Subscription] Reactivate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================== GET INVOICES =====================
router.get('/invoices', auth, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe no está configurado' });

    const user = await getUserById(req.userId);
    if (!user || !user.stripe_customer_id) {
      return res.json({ invoices: [] });
    }

    const invoices = await stripe.invoices.list({
      customer: user.stripe_customer_id,
      limit: 20,
    });

    res.json({
      invoices: invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        invoice_pdf: inv.invoice_pdf,
        hosted_invoice_url: inv.hosted_invoice_url,
        period_start: inv.period_start,
        period_end: inv.period_end,
      })),
    });
  } catch (err) {
    console.error('[Subscription] Invoices error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================== GET SINGLE INVOICE PDF =====================
router.get('/invoice/:invoiceId', auth, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) return res.status(500).json({ error: 'Stripe no está configurado' });

    const user = await getUserById(req.userId);
    if (!user || !user.stripe_customer_id) {
      return res.status(404).json({ error: 'No hay cliente asociado' });
    }

    const invoice = await stripe.invoices.retrieve(req.params.invoiceId);
    if (invoice.customer !== user.stripe_customer_id) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    res.json({
      invoice_pdf: invoice.invoice_pdf,
      hosted_invoice_url: invoice.hosted_invoice_url,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
