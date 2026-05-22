require('dotenv').config();

// ── Paystack ───────────────────────────────────────
let paystack = null;
try {
  if (process.env.PAYSTACK_SECRET_KEY) {
    const axios = require('axios');
    paystack = {
      initialize: async ({ email, amount, currency,
                           reference, metadata }) => {
        const res = await axios.post(
          'https://api.paystack.co/transaction/initialize',
          { email, amount: Math.round(amount * 100),
            currency, reference, metadata },
          { headers: {
              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              'Content-Type': 'application/json',
            }
          }
        );
        return res.data.data;
      },
      verify: async (reference) => {
        const res = await axios.get(
          `https://api.paystack.co/transaction/verify/${reference}`,
          { headers: {
              Authorization:
                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            }
          }
        );
        return res.data.data;
      },
    };
  }
} catch {}

// ── Stripe ─────────────────────────────────────────
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
} catch {}

// ── Initialize payment ─────────────────────────────
async function initializePayment({
  provider, email, amount, currency,
  reference, metadata, successUrl, cancelUrl
}) {
  if (provider === 'paystack' && paystack) {
    try {
      const data = await paystack.initialize({
        email, amount, currency: currency || 'GHS',
        reference, metadata,
      });
      return {
        provider:    'paystack',
        authorizationUrl: data.authorization_url,
        reference:   data.reference,
        accessCode:  data.access_code,
      };
    } catch (err) {
      console.error('Paystack init error:', err.message);
      if (!stripe) throw err;
      console.log('Falling back to Stripe...');
    }
  }

  if (stripe) {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency:     (currency || 'usd').toLowerCase(),
          product_data: { name: metadata?.description || 'Hostel Booking' },
          unit_amount:  Math.round(amount * 100),
        },
        quantity: 1,
      }],
      mode:        'payment',
      success_url: successUrl,
      cancel_url:  cancelUrl,
      metadata,
      client_reference_id: reference,
    });
    return {
      provider:         'stripe',
      authorizationUrl: session.url,
      reference:        session.id,
    };
  }

  throw new Error('No payment provider configured.');
}

// ── Verify payment ─────────────────────────────────
async function verifyPayment(provider, reference) {
  if (provider === 'paystack' && paystack) {
    const data = await paystack.verify(reference);
    return {
      success:   data.status === 'success',
      amount:    data.amount / 100,
      currency:  data.currency,
      reference: data.reference,
    };
  }

  if (provider === 'stripe' && stripe) {
    const session = await stripe.checkout.sessions
      .retrieve(reference);
    return {
      success:   session.payment_status === 'paid',
      amount:    session.amount_total / 100,
      currency:  session.currency,
      reference: session.id,
    };
  }

  throw new Error('Cannot verify — unknown provider.');
}

module.exports = {
  initializePayment,
  verifyPayment,
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  stripePublicKey:   process.env.STRIPE_PUBLIC_KEY   || '',
};