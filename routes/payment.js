const router  = require('express').Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const {
  initializePayment,
  verifyPayment,
  paystackPublicKey,
  stripePublicKey,
} = require('../services/payment');

// GET /api/payment/config
router.get('/config', auth, (req, res) => {
  res.json({
    paystackPublicKey,
    stripePublicKey,
    preferredProvider: paystackPublicKey ? 'paystack' : 'stripe',
  });
});

// POST /api/payment/initialize
// Called when client clicks "Pay Now" after booking is approved
router.post('/initialize', auth, async (req, res) => {
  try {
    const { bookingId, provider } = req.body;
    if (!bookingId) {
      return res.status(400).json({
        error: 'bookingId is required.'
      });
    }

    // Fetch booking
    const booking = db.prepare(`
      SELECT b.*, h.name AS hostel_name,
             h.contact_phone,
             u.email AS client_email,
             u.full_name AS client_name,
             r.price_per_person
      FROM bookings b
      JOIN hostels h ON h.id = b.hostel_id
      JOIN users   u ON u.id = b.client_id
      LEFT JOIN rooms r
        ON r.hostel_id = b.hostel_id
        AND r.room_type = b.room_type
      WHERE b.id = ? AND b.client_id = ?
    `).get(bookingId, req.user.id);

    if (!booking) {
      return res.status(404).json({
        error: 'Booking not found.'
      });
    }
    if (booking.status !== 'approved') {
      return res.status(400).json({
        error: 'Payment is only available for approved bookings.'
      });
    }

    // Check if already paid
    const existing = db.prepare(
      "SELECT * FROM payments WHERE booking_id=? AND status='paid'"
    ).get(bookingId);
    if (existing) {
      return res.status(409).json({
        error: 'This booking has already been paid.'
      });
    }

    // Calculate amount
    const pricePerPerson = booking.price_per_person || 0;
    const amount = pricePerPerson * booking.number_of_people;

    if (amount <= 0) {
      return res.status(400).json({
        error: 'Invalid payment amount. Check room pricing.'
      });
    }

    const reference = `BDHI-${bookingId}-${Date.now()}`;
    const chosenProvider = provider ||
      (paystackPublicKey ? 'paystack' : 'stripe');

    const result = await initializePayment({
      provider:   chosenProvider,
      email:      booking.client_email,
      amount,
      currency:   chosenProvider === 'paystack' ? 'GHS' : 'usd',
      reference,
      metadata: {
        bookingId,
        clientName:  booking.client_name,
        hostelName:  booking.hostel_name,
        roomType:    booking.room_type,
        people:      booking.number_of_people,
        description: `${booking.hostel_name} — ${booking.room_type} x${booking.number_of_people}`,
      },
      successUrl: `${process.env.CLIENT_URL}/payment/success?ref=${reference}&provider=${chosenProvider}`,
      cancelUrl:  `${process.env.CLIENT_URL}/payment/cancel`,
    });

    // Create pending payment record
    db.prepare(`
      INSERT OR REPLACE INTO payments
        (booking_id, client_id, hostel_id, amount,
         currency, provider, provider_ref, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      bookingId, req.user.id, booking.hostel_id,
      amount,
      chosenProvider === 'paystack' ? 'GHS' : 'USD',
      chosenProvider,
      result.reference
    );

    res.json({
      authorizationUrl: result.authorizationUrl,
      reference:        result.reference,
      provider:         result.provider,
      amount,
      currency: chosenProvider === 'paystack' ? 'GHS' : 'USD',
    });

  } catch (err) {
    console.error('Payment init error:', err);
    res.status(500).json({
      error: err.message || 'Payment initialization failed.'
    });
  }
});

// POST /api/payment/verify
router.post('/verify', auth, async (req, res) => {
  try {
    const { reference, provider } = req.body;
    if (!reference || !provider) {
      return res.status(400).json({
        error: 'reference and provider are required.'
      });
    }

    const payment = db.prepare(
      'SELECT * FROM payments WHERE provider_ref = ?'
    ).get(reference);

    if (!payment) {
      return res.status(404).json({
        error: 'Payment record not found.'
      });
    }

    const result = await verifyPayment(provider, reference);

    if (result.success) {
      // Mark payment as paid
      db.prepare(`
        UPDATE payments
        SET status='paid', paid_at=CURRENT_TIMESTAMP
        WHERE provider_ref=?
      `).run(reference);

      // Mark booking as paid
      db.prepare(`
        UPDATE bookings SET status='paid' WHERE id=?
      `).run(payment.booking_id);

      res.json({
        success:   true,
        message:   'Payment verified successfully!',
        amount:    result.amount,
        currency:  result.currency,
        reference: result.reference,
      });
    } else {
      res.json({
        success: false,
        message: 'Payment not completed.',
      });
    }
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// GET /api/payment/status/:bookingId
router.get('/status/:bookingId', auth, (req, res) => {
  const payment = db.prepare(
    'SELECT * FROM payments WHERE booking_id = ?'
  ).get(req.params.bookingId);
  res.json({ payment: payment || null });
});

// GET /api/payment/history
router.get('/history', auth, (req, res) => {
  const payments = db.prepare(`
    SELECT p.*, b.room_type, b.number_of_people,
           h.name AS hostel_name
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    JOIN hostels  h ON h.id = p.hostel_id
    WHERE p.client_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id);
  res.json({ payments });
});

module.exports = router;