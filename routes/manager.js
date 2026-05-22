const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── File upload setup ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/hostel_media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|mp4|avi|mkv|mov|wmv|webm/;
    const ok = allowed.test(
      path.extname(file.originalname).toLowerCase()
    );
    cb(null, ok);
  }
});

// Guard: manager only
const managerOnly = (req, res, next) => {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Manager access only' });
  }
  next();
};

// ─────────────────────────────────────────────────
//  HOSTEL
// ─────────────────────────────────────────────────

// GET /api/manager/hostel
router.get('/hostel', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT * FROM hostels WHERE manager_id = ? LIMIT 1'
  ).get(req.user.id);
  res.json({ hostel: hostel || null });
});

// POST /api/manager/hostel
router.post('/hostel', auth, managerOnly, (req, res) => {
  const existing = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (existing) {
    return res.status(409).json({
      error: 'You already have a registered hostel.'
    });
  }

  const { name, location, address, description, contactPhone } = req.body;
  if (!name || !location || !contactPhone) {
    return res.status(400).json({
      error: 'Name, location and contact are required.'
    });
  }

  const result = db.prepare(`
    INSERT INTO hostels
      (manager_id, name, location, address,
       description, contact_phone, is_approved)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(req.user.id, name, location,
         address || '', description || '', contactPhone);

  const hostel = db.prepare(
    'SELECT * FROM hostels WHERE id = ?'
  ).get(result.lastInsertRowid);

  res.status(201).json({
    message: 'Hostel registered! Awaiting admin approval.',
    hostel
  });
});

// PUT /api/manager/hostel
router.put('/hostel', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) {
    return res.status(404).json({ error: 'No hostel found.' });
  }

  const { name, location, address, description, contactPhone } = req.body;
  if (!name || !location || !contactPhone) {
    return res.status(400).json({
      error: 'Name, location and contact are required.'
    });
  }

  db.prepare(`
    UPDATE hostels
    SET name=?, location=?, address=?,
        description=?, contact_phone=?
    WHERE id=?
  `).run(name, location, address || '',
         description || '', contactPhone, hostel.id);

  const updated = db.prepare(
    'SELECT * FROM hostels WHERE id = ?'
  ).get(hostel.id);
  res.json({ message: 'Hostel updated.', hostel: updated });
});

// ─────────────────────────────────────────────────
//  ROOMS
// ─────────────────────────────────────────────────

// GET /api/manager/rooms
router.get('/rooms', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) return res.json({ rooms: [] });

  const rooms = db.prepare(
    'SELECT * FROM rooms WHERE hostel_id = ? ORDER BY room_type'
  ).all(hostel.id);
  res.json({ rooms });
});

// POST /api/manager/rooms
router.post('/rooms', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) {
    return res.status(404).json({
      error: 'Register a hostel first.'
    });
  }

  const {
    roomType, totalRooms, availableRooms,
    pricePerPerson, description
  } = req.body;

  if (!roomType || !totalRooms || !pricePerPerson) {
    return res.status(400).json({
      error: 'Room type, total rooms and price are required.'
    });
  }
  if (availableRooms > totalRooms) {
    return res.status(400).json({
      error: 'Available rooms cannot exceed total rooms.'
    });
  }

  const result = db.prepare(`
    INSERT INTO rooms
      (hostel_id, room_type, total_rooms,
       available_rooms, price_per_person, description, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(hostel.id, roomType, totalRooms,
         availableRooms, pricePerPerson, description || '');

  const room = db.prepare(
    'SELECT * FROM rooms WHERE id = ?'
  ).get(result.lastInsertRowid);
  res.status(201).json({ message: 'Room added.', room });
});

// PUT /api/manager/rooms/:id
router.put('/rooms/:id', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  const room = db.prepare(
    'SELECT * FROM rooms WHERE id = ? AND hostel_id = ?'
  ).get(req.params.id, hostel?.id);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  const {
    roomType, totalRooms, availableRooms,
    pricePerPerson, description
  } = req.body;

  db.prepare(`
    UPDATE rooms
    SET room_type=?, total_rooms=?, available_rooms=?,
        price_per_person=?, description=?
    WHERE id=?
  `).run(roomType, totalRooms, availableRooms,
         pricePerPerson, description || '', room.id);

  const updated = db.prepare(
    'SELECT * FROM rooms WHERE id = ?'
  ).get(room.id);
  res.json({ message: 'Room updated.', room: updated });
});

// DELETE /api/manager/rooms/:id
router.delete('/rooms/:id', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  const room = db.prepare(
    'SELECT * FROM rooms WHERE id = ? AND hostel_id = ?'
  ).get(req.params.id, hostel?.id);
  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }
  db.prepare('DELETE FROM rooms WHERE id = ?').run(room.id);
  res.json({ message: 'Room deleted.' });
});

// ─────────────────────────────────────────────────
//  BOOKINGS
// ─────────────────────────────────────────────────

// GET /api/manager/bookings
router.get('/bookings', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) return res.json({ bookings: [] });

  const { status } = req.query;
  let sql = `
    SELECT b.*,
           u.full_name  AS client_name,
           u.email      AS client_email,
           u.phone      AS client_phone
    FROM bookings b
    JOIN users u ON u.id = b.client_id
    WHERE b.hostel_id = ?
  `;
  const params = [hostel.id];
  if (status && status !== 'all') {
    sql += ' AND b.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY b.request_date DESC';

  const bookings = db.prepare(sql).all(...params);
  res.json({ bookings });
});

// PATCH /api/manager/bookings/:id
router.patch('/bookings/:id', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  const booking = db.prepare(
    'SELECT * FROM bookings WHERE id = ? AND hostel_id = ?'
  ).get(req.params.id, hostel?.id);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }

  db.prepare(
    'UPDATE bookings SET status = ? WHERE id = ?'
  ).run(status, booking.id);

  // Update available rooms if approved
  if (status === 'approved') {
    db.prepare(`
      UPDATE rooms
      SET available_rooms = MAX(0, available_rooms - ?)
      WHERE hostel_id = ? AND room_type = ?
    `).run(booking.number_of_people, hostel.id, booking.room_type);
  }

  res.json({ message: `Booking ${status}.` });
});

// ─────────────────────────────────────────────────
//  MESSAGES
// ─────────────────────────────────────────────────

// GET /api/manager/messages
router.get('/messages', auth, managerOnly, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*,
           u.full_name AS sender_name,
           u.email     AS sender_email
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.receiver_id = ?
    ORDER BY m.created_at DESC
  `).all(req.user.id);
  res.json({ messages });
});

// PATCH /api/manager/messages/:id/read
router.patch('/messages/:id/read', auth, managerOnly, (req, res) => {
  db.prepare(
    'UPDATE messages SET is_read = 1 WHERE id = ? AND receiver_id = ?'
  ).run(req.params.id, req.user.id);
  res.json({ message: 'Marked as read.' });
});

// POST /api/manager/messages/reply
router.post('/messages/reply', auth, managerOnly, (req, res) => {
  const { receiverId, subject, content, hostelId } = req.body;
  if (!receiverId || !content) {
    return res.status(400).json({
      error: 'Receiver and content are required.'
    });
  }
  db.prepare(`
    INSERT INTO messages
      (sender_id, receiver_id, hostel_id, subject, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, receiverId,
         hostelId || null, subject || 'Reply', content);

  res.json({ message: 'Reply sent.' });
});

// ─────────────────────────────────────────────────
//  NOTICES
// ─────────────────────────────────────────────────

// GET /api/manager/notices
router.get('/notices', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) return res.json({ notices: [] });

  const notices = db.prepare(
    'SELECT * FROM notices WHERE hostel_id = ? ORDER BY created_at DESC'
  ).all(hostel.id);
  res.json({ notices });
});

// POST /api/manager/notices
router.post('/notices', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) {
    return res.status(404).json({
      error: 'Register a hostel first.'
    });
  }

  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({
      error: 'Title and content are required.'
    });
  }

  const result = db.prepare(
    'INSERT INTO notices (hostel_id, title, content) VALUES (?, ?, ?)'
  ).run(hostel.id, title, content);

  const notice = db.prepare(
    'SELECT * FROM notices WHERE id = ?'
  ).get(result.lastInsertRowid);
  res.status(201).json({ message: 'Notice posted.', notice });
});

// DELETE /api/manager/notices/:id
router.delete('/notices/:id', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  db.prepare(
    'DELETE FROM notices WHERE id = ? AND hostel_id = ?'
  ).run(req.params.id, hostel?.id);
  res.json({ message: 'Notice deleted.' });
});

// ─────────────────────────────────────────────────
//  MEDIA
// ─────────────────────────────────────────────────

// GET /api/manager/media
router.get('/media', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  if (!hostel) return res.json({ media: [] });

  const media = db.prepare(
    'SELECT * FROM hostel_media WHERE hostel_id = ? ORDER BY uploaded_at DESC'
  ).all(hostel.id);
  res.json({ media });
});

// POST /api/manager/media
router.post('/media', auth, managerOnly,
  upload.array('files', 20), (req, res) => {
    const hostel = db.prepare(
      'SELECT id FROM hostels WHERE manager_id = ?'
    ).get(req.user.id);
    if (!hostel) {
      return res.status(404).json({
        error: 'Register a hostel first.'
      });
    }

    const videoExts = ['mp4','avi','mkv','mov','wmv','flv','webm'];
    const uploaded  = [];

    for (const file of req.files) {
      const ext      = path.extname(file.originalname)
        .toLowerCase().replace('.', '');
      const fileType = videoExts.includes(ext) ? 'video' : 'image';
      const filePath = `/uploads/hostel_media/${file.filename}`;

      const result = db.prepare(`
        INSERT INTO hostel_media
          (hostel_id, file_path, file_type)
        VALUES (?, ?, ?)
      `).run(hostel.id, filePath, fileType);

      uploaded.push({
        id: result.lastInsertRowid,
        filePath,
        fileType,
        originalName: file.originalname
      });
    }

    res.status(201).json({
      message: `${uploaded.length} file(s) uploaded.`,
      media: uploaded
    });
  }
);

// DELETE /api/manager/media/:id
router.delete('/media/:id', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT id FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);
  const media = db.prepare(
    'SELECT * FROM hostel_media WHERE id = ? AND hostel_id = ?'
  ).get(req.params.id, hostel?.id);
  if (!media) {
    return res.status(404).json({ error: 'Media not found.' });
  }

  // Delete file from disk
  const fullPath = path.join(__dirname, '..', media.file_path);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  db.prepare('DELETE FROM hostel_media WHERE id = ?').run(media.id);
  res.json({ message: 'Media deleted.' });
});

// GET /api/manager/messages/:id — full message detail
router.get('/messages/:id', auth, managerOnly, (req, res) => {
  const message = db.prepare(`
    SELECT m.*, u.full_name AS sender_name,
           u.email AS sender_email, u.phone AS sender_phone,
           h.name AS hostel_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN hostels h ON h.id = m.hostel_id
    WHERE m.id = ? AND m.receiver_id = ?
  `).get(req.params.id, req.user.id);

  if (!message) {
    return res.status(404).json({ error: 'Not found.' });
  }

  db.prepare(
    'UPDATE messages SET is_read=1 WHERE id=?'
  ).run(message.id);

  res.json({ message });
});

// ─────────────────────────────────────────────────
//  STATS (dashboard summary)
// ─────────────────────────────────────────────────
router.get('/stats', auth, managerOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT * FROM hostels WHERE manager_id = ?'
  ).get(req.user.id);

  if (!hostel) {
    return res.json({
      hostel: null,
      stats: {
        pendingBookings: 0,
        approvedBookings: 0,
        unreadMessages: 0,
        totalRooms: 0,
        recentBookings: []
      }
    });
  }

  const pending = db.prepare(
    "SELECT COUNT(*) AS c FROM bookings WHERE hostel_id=? AND status='pending'"
  ).get(hostel.id).c;

  const approved = db.prepare(
    "SELECT COUNT(*) AS c FROM bookings WHERE hostel_id=? AND status='approved'"
  ).get(hostel.id).c;

  const unread = db.prepare(
    'SELECT COUNT(*) AS c FROM messages WHERE receiver_id=? AND is_read=0'
  ).get(req.user.id).c;

  const totalRooms = db.prepare(
    'SELECT COALESCE(SUM(total_rooms),0) AS c FROM rooms WHERE hostel_id=?'
  ).get(hostel.id).c;

  const recentBookings = db.prepare(`
    SELECT b.*, u.full_name AS client_name
    FROM bookings b
    JOIN users u ON u.id = b.client_id
    WHERE b.hostel_id = ?
    ORDER BY b.request_date DESC
    LIMIT 5
  `).all(hostel.id);

  res.json({
    hostel,
    stats: {
      pendingBookings:  pending,
      approvedBookings: approved,
      unreadMessages:   unread,
      totalRooms,
      recentBookings
    }
  });
});

module.exports = router;