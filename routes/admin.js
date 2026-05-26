const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const bcrypt = require('bcryptjs');

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only' });
  }
  next();
};

// ─────────────────────────────────────────────────
//  STATS
// ─────────────────────────────────────────────────
router.get('/stats', auth, adminOnly, (req, res) => {
  const totalUsers    = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role != 'admin'"
  ).get().c;
  const totalClients  = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role='client'"
  ).get().c;
  const totalManagers = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role='manager'"
  ).get().c;
  const activeUsers   = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE is_active=1 AND role!='admin'"
  ).get().c;
  const totalHostels  = db.prepare(
    "SELECT COUNT(*) AS c FROM hostels"
  ).get().c;
  const pendingHostels = db.prepare(
    "SELECT COUNT(*) AS c FROM hostels WHERE is_approved=0"
  ).get().c;
  const approvedHostels = db.prepare(
    "SELECT COUNT(*) AS c FROM hostels WHERE is_approved=1"
  ).get().c;
  const totalBookings = db.prepare(
    "SELECT COUNT(*) AS c FROM bookings"
  ).get().c;
  const pendingBookings = db.prepare(
    "SELECT COUNT(*) AS c FROM bookings WHERE status='pending'"
  ).get().c;
  const totalMessages = db.prepare(
    "SELECT COUNT(*) AS c FROM messages"
  ).get().c;

  const recentUsers = db.prepare(`
    SELECT id, full_name, username, role,
           is_active, created_at
    FROM users
    WHERE role != 'admin'
    ORDER BY created_at DESC LIMIT 5
  `).all();

  const recentHostels = db.prepare(`
    SELECT h.*, u.full_name AS manager_name
    FROM hostels h
    JOIN users u ON u.id = h.manager_id
    ORDER BY h.created_at DESC LIMIT 5
  `).all();

  res.json({
    stats: {
      totalUsers, totalClients, totalManagers,
      activeUsers, totalHostels, pendingHostels,
      approvedHostels, totalBookings,
      pendingBookings, totalMessages,
      recentUsers, recentHostels,
    }
  });
});

// ─────────────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', auth, adminOnly, (req, res) => {
  const { search, role } = req.query;
  let sql = `
    SELECT id, username, full_name, email,
           phone, role, is_active, created_at
    FROM users
    WHERE role != 'admin'
  `;
  const params = [];
  if (search) {
    sql += ` AND (
      full_name LIKE ? OR username LIKE ?
      OR email LIKE ? OR phone LIKE ?
    )`;
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (role && role !== 'all') {
    sql += ' AND role = ?';
    params.push(role);
  }
  sql += ' ORDER BY created_at DESC';
  const users = db.prepare(sql).all(...params);
  res.json({ users });
});

// POST /api/admin/users
router.post('/users', auth, adminOnly, async (req, res) => {
  const {
    fullName, username, email,
    phone, password, role
  } = req.body;

  if (!fullName || !username || !email ||
      !phone    || !password || !role) {
    return res.status(400).json({
      error: 'All fields are required.'
    });
  }
  if (!['client','manager'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }
  if (password.length < 6) {
    return res.status(400).json({
      error: 'Password must be at least 6 characters.'
    });
  }

  const emailRx = /^[\w.+\-]+@[\w\-]+\.[a-zA-Z]{2,}$/;
  if (!emailRx.test(email)) {
    return res.status(400).json({
      error: 'Invalid email format.'
    });
  }
  const phoneRx = /^\+?[0-9]{7,15}$/;
  if (!phoneRx.test(phone)) {
    return res.status(400).json({
      error: 'Invalid phone number.'
    });
  }

  const taken = db.prepare(
    'SELECT id FROM users WHERE username=?'
  ).get(username);
  if (taken) {
    return res.status(409).json({
      error: `Username "${username}" is already taken.`
    });
  }
  const emailTaken = db.prepare(
    'SELECT id FROM users WHERE email=?'
  ).get(email);
  if (emailTaken) {
    return res.status(409).json({
      error: `Email "${email}" is already registered.`
    });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(`
    INSERT INTO users
      (username, password_hash, full_name, email,
       phone, role, is_active,
       email_verified, phone_verified)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1)
  `).run(username, hash, fullName, email, phone, role);

  const user = db.prepare(
    'SELECT id,username,full_name,email,phone,role,is_active FROM users WHERE id=?'
  ).get(result.lastInsertRowid);

  res.status(201).json({
    message: 'User created successfully.',
    user
  });
});

// PUT /api/admin/users/:id
router.put('/users/:id', auth, adminOnly, async (req, res) => {
  const {
    fullName, username, email,
    phone, role, password
  } = req.body;

  const existing = db.prepare(
    'SELECT * FROM users WHERE id=?'
  ).get(req.params.id);
  if (!existing || existing.role === 'admin') {
    return res.status(404).json({
      error: 'User not found.'
    });
  }

  // Uniqueness checks (exclude self)
  const uTaken = db.prepare(
    'SELECT id FROM users WHERE username=? AND id!=?'
  ).get(username, req.params.id);
  if (uTaken) {
    return res.status(409).json({
      error: `Username "${username}" is taken.`
    });
  }
  const eTaken = db.prepare(
    'SELECT id FROM users WHERE email=? AND id!=?'
  ).get(email, req.params.id);
  if (eTaken) {
    return res.status(409).json({
      error: `Email "${email}" is registered.`
    });
  }

  if (password && password.length >= 6) {
    const hash = await bcrypt.hash(password, 10);
    db.prepare(`
      UPDATE users
      SET full_name=?, username=?, email=?,
          phone=?, role=?, password_hash=?
      WHERE id=?
    `).run(fullName, username, email,
           phone, role, hash, req.params.id);
  } else {
    db.prepare(`
      UPDATE users
      SET full_name=?, username=?, email=?,
          phone=?, role=?
      WHERE id=?
    `).run(fullName, username, email,
           phone, role, req.params.id);
  }

  const updated = db.prepare(
    'SELECT id,username,full_name,email,phone,role,is_active FROM users WHERE id=?'
  ).get(req.params.id);

  res.json({ message: 'User updated.', user: updated });
});

// PATCH /api/admin/users/:id/toggle
router.patch(
  '/users/:id/toggle', auth, adminOnly, (req, res) => {
    const user = db.prepare(
      'SELECT * FROM users WHERE id=?'
    ).get(req.params.id);
    if (!user || user.role === 'admin') {
      return res.status(404).json({
        error: 'User not found.'
      });
    }
    const newStatus = user.is_active ? 0 : 1;
    db.prepare(
      'UPDATE users SET is_active=? WHERE id=?'
    ).run(newStatus, user.id);
    res.json({
      message: `User ${newStatus ? 'activated' : 'deactivated'}.`,
      is_active: newStatus,
    });
  }
);

// DELETE /api/admin/users/:id
router.delete('/users/:id', auth, adminOnly, (req, res) => {
  const user = db.prepare(
    'SELECT * FROM users WHERE id=?'
  ).get(req.params.id);
  if (!user || user.role === 'admin') {
    return res.status(404).json({
      error: 'Admin accounts cannot be deleted.'
    });
  }
  db.prepare('DELETE FROM users WHERE id=?').run(user.id);
  res.json({ message: `User "${user.username}" deleted.` });
});

// ─────────────────────────────────────────────────
//  HOSTELS
// ─────────────────────────────────────────────────

// GET /api/admin/hostels
router.get('/hostels', auth, adminOnly, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT h.*, u.full_name AS manager_name,
           u.email AS manager_email,
           u.phone AS manager_phone,
           COUNT(DISTINCT r.id) AS room_count,
           COUNT(DISTINCT b.id) AS booking_count
    FROM hostels h
    JOIN users u ON u.id = h.manager_id
    LEFT JOIN rooms r ON r.hostel_id = h.id
    LEFT JOIN bookings b ON b.hostel_id = h.id
  `;
  const params = [];
  if (status === 'pending') {
    sql += ' WHERE h.is_approved = 0';
  } else if (status === 'approved') {
    sql += ' WHERE h.is_approved = 1';
  }
  sql += ' GROUP BY h.id ORDER BY h.created_at DESC';
  const hostels = db.prepare(sql).all(...params);
  res.json({ hostels });
});

// PATCH /api/admin/hostels/:id/approve
router.patch(
  '/hostels/:id/approve', auth, adminOnly, (req, res) => {
    const hostel = db.prepare(
      'SELECT * FROM hostels WHERE id=?'
    ).get(req.params.id);
    if (!hostel) {
      return res.status(404).json({
        error: 'Hostel not found.'
      });
    }
    db.prepare(
      'UPDATE hostels SET is_approved=1 WHERE id=?'
    ).run(hostel.id);
    res.json({ message: 'Hostel approved.' });
  }
);

// DELETE /api/admin/hostels/:id
router.delete('/hostels/:id', auth, adminOnly, (req, res) => {
  const hostel = db.prepare(
    'SELECT * FROM hostels WHERE id=?'
  ).get(req.params.id);
  if (!hostel) {
    return res.status(404).json({
      error: 'Hostel not found.'
    });
  }
  db.prepare('DELETE FROM hostels WHERE id=?').run(hostel.id);
  res.json({ message: 'Hostel removed.' });
});

// ─────────────────────────────────────────────────
//  BOOKINGS (overview)
// ─────────────────────────────────────────────────
router.get('/bookings', auth, adminOnly, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT b.*,
           u.full_name  AS client_name,
           h.name       AS hostel_name,
           h.location   AS hostel_location
    FROM bookings b
    JOIN users   u ON u.id = b.client_id
    JOIN hostels h ON h.id = b.hostel_id
  `;
  if (status && status !== 'all') {
    sql += ' WHERE b.status = ?';
  }
  sql += ' ORDER BY b.request_date DESC';

  const bookings = status && status !== 'all'
    ? db.prepare(sql).all(status)
    : db.prepare(sql).all();

  res.json({ bookings });
});

// ─────────────────────────────────────────────────
//  PROFILE — change password
// ─────────────────────────────────────────────────
router.put('/profile/password', auth, adminOnly, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'All password fields are required.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        error: 'New password must be at least 6 characters.'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'New passwords do not match.'
      });
    }

    const admin = db
      .prepare('SELECT * FROM users WHERE id = ? AND role = ?')
      .get(req.user.id, 'admin');

    if (!admin) {
      return res.status(404).json({ error: 'Admin not found.' });
    }

    const match = await bcrypt.compare(
      currentPassword, admin.password_hash
    );
    if (!match) {
      return res.status(401).json({
        error: 'Current password is incorrect.'
      });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare(
      'UPDATE users SET password_hash = ? WHERE id = ?'
    ).run(hash, admin.id);

    res.json({ message: 'Password changed successfully!' });

  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password.' });
  }
});

// GET /api/admin/profile
router.get('/profile', auth, adminOnly, (req, res) => {
  const admin = db.prepare(
    'SELECT id,username,full_name,email,role,created_at FROM users WHERE id=?'
  ).get(req.user.id);
  if (!admin) return res.status(404).json({ error: 'Not found.' });
  res.json({ admin });
});

module.exports = router;