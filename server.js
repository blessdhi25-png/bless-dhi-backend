require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

// ── Middleware ─────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Rate limiting on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many requests. Try again later.' }
});

// ── Routes ─────────────────────────────────────────
app.use('/api/auth', authLimiter, require('./routes/auth'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', app: 'Bless Dhi API' });
});

// ── Start ──────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Bless Dhi API running on port ${PORT}`);
});

require('dotenv').config();
//const express   = require('express');
//const cors      = require('cors');
//const rateLimit = require('express-rate-limit');
const path      = require('path');

//const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Serve uploaded media files
app.use('/uploads', express.static(
  path.join(__dirname, 'uploads')
));



app.use('/api/auth',    authLimiter, require('./routes/auth'));
app.use('/api/manager', require('./routes/manager'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', app: 'Bless Dhi API' });
});

//const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Bless Dhi API running on port ${PORT}`);
});

app.use('/api/client',  require('./routes/client'));
app.use('/api/admin',   require('./routes/admin'));
app.use('/api/payment', require('./routes/payment')); // ← add