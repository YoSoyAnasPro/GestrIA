const Stripe = require('stripe');

let instance = null;

function getStripeClient() {
  if (instance) return instance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('[Stripe] STRIPE_SECRET_KEY environment variable is required');
    return null;
  }
  instance = new Stripe(key, {
    apiVersion: '2025-05-28.basil',
    typescript: false,
  });
  return instance;
}

module.exports = { getStripeClient };
