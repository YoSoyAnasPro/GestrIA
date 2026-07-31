const { getUserById } = require('../database');

const FREE_ACCESS_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/webhooks/',
  '/api/public/',
  '/cal/',
];

function isFreeAccessRoute(path) {
  return FREE_ACCESS_ROUTES.some(r => path.startsWith(r));
}

async function requireSubscription(req, res, next) {
  if (isFreeAccessRoute(req.path)) return next();

  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const status = user.subscription_status || 'inactive';
    const activeStatuses = ['active', 'trialing'];

    if (activeStatuses.includes(status)) {
      req.userSubscription = {
        status,
        plan: user.subscription_plan || null,
      };
      return next();
    }

    if (status === 'past_due') {
      req.userSubscription = { status, plan: user.subscription_plan || null };
      return next();
    }

    if (status === 'incomplete') {
      return res.status(402).json({
        error: 'Suscripción pendiente de pago',
        subscription_required: true,
        redirect: '/#/pricing',
      });
    }

    return res.status(403).json({
      error: 'Suscripción inactiva o cancelada',
      subscription_required: true,
      redirect: '/#/pricing',
    });
  } catch (err) {
    console.error('[Subscription Middleware] Error:', err.message);
    next();
  }
}

function isSubscriptionActive(user) {
  return ['active', 'trialing'].includes(user.subscription_status || 'inactive');
}

module.exports = { requireSubscription, isSubscriptionActive };
