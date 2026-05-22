const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

const clientOnly = (req, res, next) => {
  if (req.user.role !== 'client') {
    return res.status(403).json({ error: 'Client access only' });
  }
  next();
};

// ─────────────────────────────────────────────────
//  HOSTELS
// ─────────────────────────────────────────────────

// GET /api/client/hostels
router.get('/hostels', auth, clientOnly, (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT h.*,
      COUNT(DISTINCT r.id) AS room_types,
      COALESCE(MIN(r.price_per_person), 0) AS min_price,
      COALESCE(MAX(r.price_per_person), 0) AS max_price,
      COALESCE(SUM(r.available_rooms), 0)  AS total_available,
      u.full_name AS manager_name
    FROM hostels h
    LEFT JOIN rooms r
      ON r.hostel_id = h.id AND r.is_active = 1
    LEFT JOIN users u ON u.id = h.manager_id
    WHERE h.is_approved = 1
  `;
  const params = [];
  if (search) {
    sql += ` AND (
      h.name        LIKE ? OR
      h.location    LIKE ? OR
      h.description LIKE ?
    )`;
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  sql += ' GROUP BY h.id ORDER BY h.name';
  const hostels = db.prepare(sql).all(...params);
  res.json({ hostels });
});

// GET /api/client/hostels/:id
router.get('/hostels/:id', auth, clientOnly, (req, res) => {
  const hostel = db.prepare(`
    SELECT h.*, u.full_name AS manager_name
    FROM hostels h
    JOIN users u ON u.id = h.manager_id
    WHERE h.id = ? AND h.is_approved = 1
  `).get(req.params.id);

  if (!hostel) {
    return res.status(404).json({ error: 'Hostel not found.' });
  }

  const rooms = db.prepare(`
    SELECT * FROM rooms
    WHERE hostel_id = ? AND is_active = 1
    ORDER BY price_per_person
  `).all(hostel.id);

  const media = db.prepare(`
    SELECT * FROM hostel_media
    WHERE hostel_id = ?
    ORDER BY uploaded_at DESC
  `).all(hostel.id);

  const notices = db.prepare(`
    SELECT * FROM notices
    WHERE hostel_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(hostel.id);

  res.json({ hostel, rooms, media, notices });
});

// ─────────────────────────────────────────────────
//  BOOKINGS
// ─────────────────────────────────────────────────

// GET /api/client/bookings
router.get('/bookings', auth, clientOnly, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT b.*,
           h.name     AS hostel_name,
           h.location AS hostel_location
    FROM bookings b
    JOIN hostels h ON h.id = b.hostel_id
    WHERE b.client_id = ?
  `;
  const params = [req.user.id];
  if (status && status !== 'all') {
    sql += ' AND b.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY b.request_date DESC';
  const bookings = db.prepare(sql).all(...params);
  res.json({ bookings });
});

// POST /api/client/bookings
router.post('/bookings', auth, clientOnly, (req, res) => {
  const { hostelId, roomType, numberOfPeople } = req.body;
  if (!hostelId || !roomType || !numberOfPeople) {
    return res.status(400).json({
      error: 'Hostel, room type and number of people are required.'
    });
  }

  // Check duplicate pending
  const dup = db.prepare(`
    SELECT id FROM bookings
    WHERE client_id=? AND hostel_id=? AND status='pending'
  `).get(req.user.id, hostelId);
  if (dup) {
    return res.status(409).json({
      error: 'You already have a pending booking for this hostel.'
    });
  }

  const result = db.prepare(`
    INSERT INTO bookings
      (client_id, hostel_id, room_type, number_of_people, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(req.user.id, hostelId, roomType, numberOfPeople);

  const booking = db.prepare(
    'SELECT * FROM bookings WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.status(201).json({
    message: 'Booking request sent successfully!',
    booking
  });
});

// DELETE /api/client/bookings/:id
router.delete('/bookings/:id', auth, clientOnly, (req, res) => {
  const booking = db.prepare(`
    SELECT * FROM bookings
    WHERE id = ? AND client_id = ?
  `).get(req.params.id, req.user.id);

  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }
  if (booking.status !== 'pending') {
    return res.status(400).json({
      error: 'Only pending bookings can be cancelled.'
    });
  }
  db.prepare('DELETE FROM bookings WHERE id = ?')
    .run(booking.id);
  res.json({ message: 'Booking cancelled.' });
});

// ─────────────────────────────────────────────────
//  MESSAGES
// ─────────────────────────────────────────────────

// GET /api/client/messages
router.get('/messages', auth, clientOnly, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*,
           u.full_name AS sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.receiver_id = ?
    ORDER BY m.created_at DESC
  `).all(req.user.id);

  // Mark all as read
  db.prepare(
    'UPDATE messages SET is_read=1 WHERE receiver_id=?'
  ).run(req.user.id);

  res.json({ messages });
});

// POST /api/client/messages
router.post('/messages', auth, clientOnly, (req, res) => {
  const { hostelId, subject, content } = req.body;
  if (!hostelId || !content) {
    return res.status(400).json({
      error: 'Hostel and message content are required.'
    });
  }

  const hostel = db.prepare(
    'SELECT manager_id FROM hostels WHERE id = ?'
  ).get(hostelId);
  if (!hostel) {
    return res.status(404).json({ error: 'Hostel not found.' });
  }

  db.prepare(`
    INSERT INTO messages
      (sender_id, receiver_id, hostel_id, subject, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.user.id, hostel.manager_id,
    hostelId, subject || '', content
  );

  res.json({ message: 'Message sent successfully!' });
});

// GET /api/client/messages/:id  — full message detail
router.get('/messages/:id', auth, clientOnly, (req, res) => {
  const message = db.prepare(`
    SELECT m.*, u.full_name AS sender_name,
           h.name AS hostel_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN hostels h ON h.id = m.hostel_id
    WHERE m.id = ? AND m.receiver_id = ?
  `).get(req.params.id, req.user.id);

  if (!message) {
    return res.status(404).json({ error: 'Message not found.' });
  }

  // Mark as read
  db.prepare(
    'UPDATE messages SET is_read=1 WHERE id=?'
  ).run(message.id);

  res.json({ message });
});

// ─────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────
router.get('/stats', auth, clientOnly, (req, res) => {
  const pending = db.prepare(`
    SELECT COUNT(*) AS c FROM bookings
    WHERE client_id=? AND status='pending'
  `).get(req.user.id).c;

  const approved = db.prepare(`
    SELECT COUNT(*) AS c FROM bookings
    WHERE client_id=? AND status='approved'
  `).get(req.user.id).c;

  const hostels = db.prepare(`
    SELECT COUNT(*) AS c FROM hostels WHERE is_approved=1
  `).get().c;

  const unread = db.prepare(`
    SELECT COUNT(*) AS c FROM messages
    WHERE receiver_id=? AND is_read=0
  `).get(req.user.id).c;

  const recentBookings = db.prepare(`
    SELECT b.*, h.name AS hostel_name
    FROM bookings b
    JOIN hostels h ON h.id = b.hostel_id
    WHERE b.client_id = ?
    ORDER BY b.request_date DESC LIMIT 5
  `).all(req.user.id);

  res.json({
    stats: {
      pending, approved, hostels,
      unread, recentBookings
    }
  });
});

module.exports = router;