const router     = require('express').Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const db         = require('../db');
const { sendOTPSMS, normalizePhone } = require('../services/sms'); // ← fixed
require('dotenv').config();

// ── Email transporter ──────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false },
});

transporter.verify((err, ok) => {
  if (err) console.error('[Email] Transporter error:', err.message);
  else     console.log('[Email] Ready to send');
});

// ── Helpers ────────────────────────────────────────
const genOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

async function sendOTPEmail(to, code) {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM,
    to,
    subject: 'Verify your email - Bless Dhi',
    html: `
      <div style="font-family:sans-serif;max-width:480px;
                  margin:0 auto;padding:32px;
                  background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#1a237e;margin-bottom:8px;">
          Bless Dhi Hostel System
        </h2>
        <p style="color:#555;margin-bottom:24px;">
          Your email verification code is:
        </p>
        <div style="background:#1a237e;color:white;
                    font-size:36px;font-weight:bold;
                    letter-spacing:12px;text-align:center;
                    padding:20px;border-radius:10px;
                    margin-bottom:24px;">
          ${code}
        </div>
        <p style="color:#888;font-size:13px;">
          This code expires in <strong>10 minutes</strong>.
          Do not share it with anyone.
        </p>
      </div>
    `,
  });
}

// ── POST /api/auth/register ────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { fullName, username, email,
            phone, password, role } = req.body;

    if (!fullName || !username || !email ||
        !phone    || !password || !role) {
      return res.status(400).json({
        error: 'All fields are required'
      });
    }

    const emailRx = /^[\w.+\-]+@[\w\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRx.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters'
      });
    }

    if (!['client', 'manager'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Normalize and validate phone
    const normalizedPhone = normalizePhone(
      phone.replace(/[\s\-\(\)]/g, '')
    );
    if (normalizedPhone.length !== 13) {
      return res.status(400).json({
        error: 'Invalid phone number. Use format: 0XXXXXXXXX or +233XXXXXXXXX'
      });
    }

    // Uniqueness checks
    const existingUser = db
      .prepare('SELECT id FROM users WHERE username=?')
      .get(username.trim());
    if (existingUser) {
      return res.status(409).json({
        error: `Username "${username}" is already taken`
      });
    }

    const existingEmail = db
      .prepare('SELECT id FROM users WHERE LOWER(email)=LOWER(?)')
      .get(email.trim());
    if (existingEmail) {
      return res.status(409).json({
        error: `Email "${email}" is already registered`
      });
    }

    const existingPhone = db
      .prepare('SELECT id FROM users WHERE phone=?')
      .get(normalizedPhone);
    if (existingPhone) {
      return res.status(409).json({
        error: 'Phone number is already registered'
      });
    }

    // Create user with normalized phone
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(`
      INSERT INTO users
        (username, password_hash, full_name, email,
         phone, role, is_active, email_verified, phone_verified)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0)
    `).run(
      username.trim(), hash, fullName.trim(),
      email.trim().toLowerCase(), normalizedPhone, role
    );

    const userId = result.lastInsertRowid;

    // Generate + send email OTP
    const code    = genOTP();
    const expires = new Date(Date.now() + 10 * 60 * 1000)
      .toISOString();

    db.prepare(`
      INSERT INTO otp_codes
        (user_id, identifier, code, type, expires_at)
      VALUES (?, ?, ?, 'email', ?)
    `).run(userId, email.trim().toLowerCase(), code, expires);

    try {
      await sendOTPEmail(email.trim(), code);
      console.log(`[Email OTP] Sent to ${email}`);
    } catch (emailErr) {
      console.error('[Email OTP] Failed:', emailErr.message);
    }

    console.log(`[DEV] Email OTP for ${email}: ${code}`);

    res.json({
      message: 'Registration started. Check your email.',
      userId,
      step: 'verify_email'
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/verify-email ────────────────────
router.post('/verify-email', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({
        error: 'userId and code are required'
      });
    }

    const otp = db.prepare(`
      SELECT * FROM otp_codes
      WHERE user_id=? AND type='email' AND used=0
      ORDER BY created_at DESC LIMIT 1
    `).get(userId);

    if (!otp) {
      return res.status(400).json({
        error: 'No active email OTP. Please request a new one.'
      });
    }
    if (new Date() > new Date(otp.expires_at)) {
      return res.status(400).json({
        error: 'Code has expired. Please request a new one.'
      });
    }
    if (otp.code !== code.trim()) {
      return res.status(400).json({
        error: 'Incorrect code. Please try again.'
      });
    }

    // Mark used + verify email + activate account immediately
    db.prepare('UPDATE otp_codes SET used=1 WHERE id=?')
      .run(otp.id);
    db.prepare(`
      UPDATE users
      SET email_verified=1, phone_verified=1, is_active=1
      WHERE id=?
    `).run(userId);

    const userRecord = db
      .prepare('SELECT id,username,full_name,role FROM users WHERE id=?')
      .get(userId);

    // Still try to send phone OTP in background (optional)
    try {
      const user = db
        .prepare('SELECT phone FROM users WHERE id=?')
        .get(userId);

      const phoneCode = genOTP();
      const expires   = new Date(Date.now() + 10 * 60 * 1000)
        .toISOString();

      db.prepare(`
        INSERT INTO otp_codes
          (user_id, identifier, code, type, expires_at)
        VALUES (?, ?, ?, 'phone', ?)
      `).run(userId, user.phone, phoneCode, expires);

      // Send SMS without blocking
      sendOTPSMS(user.phone, phoneCode)
        .then(r => console.log('[Phone OTP] Sent:', r))
        .catch(e => console.log('[Phone OTP] Failed (optional):', e.message));

      console.log(`[DEV] Phone OTP for ${user.phone}: ${phoneCode}`);
    } catch (smsErr) {
      console.log('[Phone OTP] Skipped:', smsErr.message);
    }

    // Account is active — return complete immediately
    res.json({
      message: 'Email verified! Account activated successfully.',
      step: 'complete',
      user: {
        id:       userRecord.id,
        username: userRecord.username,
        fullName: userRecord.full_name,
        role:     userRecord.role,
      }
    });

  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/verify-phone ────────────────────
router.post('/verify-phone', async (req, res) => {
  try {
    const { userId, code } = req.body;

    const otp = db.prepare(`
      SELECT * FROM otp_codes
      WHERE user_id=? AND type='phone' AND used=0
      ORDER BY created_at DESC LIMIT 1
    `).get(userId);

    if (!otp) {
      return res.status(400).json({
        error: 'No active phone OTP found.'
      });
    }
    if (new Date() > new Date(otp.expires_at)) {
      return res.status(400).json({
        error: 'Code expired. Please resend.'
      });
    }
    if (otp.code !== code.trim()) {
      return res.status(400).json({
        error: 'Incorrect code. Try again.'
      });
    }

    db.prepare('UPDATE otp_codes SET used=1 WHERE id=?')
      .run(otp.id);
    db.prepare(`
      UPDATE users SET phone_verified=1, is_active=1 WHERE id=?
    `).run(userId);

    const user = db
      .prepare('SELECT id,username,full_name,role FROM users WHERE id=?')
      .get(userId);

    res.json({
      message: 'Account fully verified and activated!',
      step: 'complete',
      user: {
        id:       user.id,
        username: user.username,
        fullName: user.full_name,
        role:     user.role,
      }
    });

  } catch (err) {
    console.error('Verify phone error:', err);
    res.status(500).json({ error: 'Phone verification failed' });
  }
});

// ── POST /api/auth/resend-otp ──────────────────────
router.post('/resend-otp', async (req, res) => {
  try {
    const { userId, type } = req.body;
    if (!userId || !type) {
      return res.status(400).json({
        error: 'userId and type required'
      });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE id=?')
      .get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.prepare(`
      UPDATE otp_codes SET used=1
      WHERE user_id=? AND type=? AND used=0
    `).run(userId, type);

    const code       = genOTP();
    const expires    = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const identifier = type === 'email' ? user.email : user.phone;

    db.prepare(`
      INSERT INTO otp_codes
        (user_id, identifier, code, type, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, identifier, code, type, expires);

    if (type === 'email') {
      try {
        await sendOTPEmail(user.email, code);
      } catch {
        console.log(`[DEV] Resend email OTP: ${code}`);
      }
      console.log(`[DEV] Resend email OTP for ${user.email}: ${code}`);
    } else {
      try {
        const result = await sendOTPSMS(user.phone, code);
        console.log('[Phone OTP] Resend result:', result);
      } catch (err) {
        console.error('[Phone OTP] Resend failed:', err.message);
      }
      console.log('');
      console.log('╔══════════════════════════════════════╗');
      console.log('  RESEND PHONE OTP');
      console.log(`  To:   ${user.phone}`);
      console.log(`  Code: ${code}`);
      console.log('╚══════════════════════════════════════╝');
      console.log('');
    }

    res.json({ message: `New ${type} OTP sent.` });

  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Resend failed' });
  }
});

// ── POST /api/auth/login ───────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?)')
      .get(username.trim());

    if (!user) {
      return res.status(401).json({
        error: 'Invalid username or password'
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({
        error: 'Invalid username or password'
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        error: 'Account is deactivated. Contact admin.'
      });
    }

    //if (!user.email_verified && user.role !== 'admin') {
      //return res.status(403).json({
        //error: 'Please verify your email first.',
       // needsVerification: true,
        //userId: user.id,
       // step: 'verify_email'
      //});
   // }

   // To this — only require email verification:
    if (!user.email_verified && user.role !== 'admin') {
      return res.status(403).json({
        error: 'Please verify your email first.',
        needsVerification: true,
        userId: user.id,
        step: 'verify_email'
      });
    }

    const token = jwt.sign(
      {
        id:       user.id,
        username: user.username,
        role:     user.role,
        fullName: user.full_name,
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id:       user.id,
        username: user.username,
        fullName: user.full_name,
        role:     user.role,
        email:    user.email,
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ───────────────────────────────
const authMiddleware = require('../middleware/auth');
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT id,username,full_name,role,email,phone FROM users WHERE id=?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ user });
});

module.exports = router;