const Database = require('better-sqlite3');
const path     = require('path');
require('dotenv').config();

const db = new Database(
  process.env.DB_PATH || './hostel.db',
  { verbose: console.log }
);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Create tables ──────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    full_name     TEXT    NOT NULL,
    email         TEXT    UNIQUE,
    phone         TEXT    UNIQUE,
    role          TEXT    NOT NULL
                  CHECK(role IN ('admin','manager','client')),
    is_active     INTEGER DEFAULT 1,
    email_verified INTEGER DEFAULT 0,
    phone_verified INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    identifier TEXT    NOT NULL,
    code       TEXT    NOT NULL,
    type       TEXT    NOT NULL CHECK(type IN ('email','phone')),
    expires_at DATETIME NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hostels (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    manager_id    INTEGER NOT NULL,
    name          TEXT    NOT NULL,
    location      TEXT    NOT NULL,
    address       TEXT,
    description   TEXT,
    contact_phone TEXT,
    is_approved   INTEGER DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manager_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    hostel_id        INTEGER NOT NULL,
    room_type        TEXT    NOT NULL,
    total_rooms      INTEGER NOT NULL,
    available_rooms  INTEGER NOT NULL DEFAULT 0,
    price_per_person REAL    NOT NULL,
    description      TEXT,
    is_active        INTEGER DEFAULT 1,
    FOREIGN KEY (hostel_id) REFERENCES hostels(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id        INTEGER NOT NULL,
    hostel_id        INTEGER NOT NULL,
    room_type        TEXT    NOT NULL,
    number_of_people INTEGER NOT NULL,
    status           TEXT    DEFAULT 'pending',
    request_date     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id)  REFERENCES users(id),
    FOREIGN KEY (hostel_id)  REFERENCES hostels(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    hostel_id   INTEGER,
    subject     TEXT,
    content     TEXT    NOT NULL,
    is_read     INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id)   REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    hostel_id  INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    content    TEXT    NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hostel_id) REFERENCES hostels(id)
  );

  CREATE TABLE IF NOT EXISTS hostel_media (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    hostel_id   INTEGER NOT NULL,
    file_path   TEXT    NOT NULL,
    file_type   TEXT    NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hostel_id) REFERENCES hostels(id)
  );


  CREATE TABLE IF NOT EXISTS payments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id      INTEGER NOT NULL UNIQUE,
    client_id       INTEGER NOT NULL,
    hostel_id       INTEGER NOT NULL,
    amount          REAL    NOT NULL,
    currency        TEXT    DEFAULT 'GHS',
    provider        TEXT    NOT NULL,
    provider_ref    TEXT,
    status          TEXT    DEFAULT 'pending',
    paid_at         DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES bookings(id),
    FOREIGN KEY (client_id)  REFERENCES users(id),
    FOREIGN KEY (hostel_id)  REFERENCES hostels(id)
  );

`);

// Seed default admin
const bcrypt = require('bcryptjs');
const adminExists = db
  .prepare("SELECT id FROM users WHERE role='admin' LIMIT 1")
  .get();

if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO users
      (username,password_hash,full_name,role,
       email,is_active,email_verified,phone_verified)
    VALUES (?,?,?,?,?,1,1,1)
  `).run('admin', hash, 'System Administrator',
         'admin', 'admin@blessdhi.com');
  console.log('Default admin created: admin / admin123');
}

module.exports = db;