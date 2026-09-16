const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'absensi.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_meters INTEGER NOT NULL DEFAULT 150
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nik TEXT,
  nip TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  position_id INTEGER REFERENCES positions(id),
  location_id INTEGER REFERENCES locations(id),
  photo_path TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  exit_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL, -- 'masuk' | 'pulang'
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  lat REAL,
  lng REAL,
  accuracy REAL,
  distance_from_location REAL,
  photo_path TEXT NOT NULL,
  note TEXT NOT NULL,
  fake_gps_flag INTEGER NOT NULL DEFAULT 0,
  fake_gps_reasons TEXT
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  type TEXT NOT NULL, -- 'izin' | 'sakit'
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  proof_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER REFERENCES employees(id),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed default data on first run
const positionCount = db.prepare('SELECT COUNT(*) AS c FROM positions').get().c;
if (positionCount === 0) {
  const insertPos = db.prepare('INSERT INTO positions (name) VALUES (?)');
  ['Staff', 'Supervisor', 'Manager', 'HCM'].forEach((p) => insertPos.run(p));
}

const locationCount = db.prepare('SELECT COUNT(*) AS c FROM locations').get().c;
if (locationCount === 0) {
  db.prepare('INSERT INTO locations (name, lat, lng, radius_meters) VALUES (?, ?, ?, ?)').run(
    'Kantor Pusat Jakarta',
    -6.2088,
    106.8456,
    150
  );
}

const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'hcm@tritronik.com';
const admin = db.prepare('SELECT id FROM employees WHERE email = ?').get(adminEmail);
if (!admin) {
  const defaultLocation = db.prepare('SELECT id FROM locations LIMIT 1').get();
  const hcmPosition = db.prepare("SELECT id FROM positions WHERE name = 'HCM'").get();
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || crypto.randomBytes(6).toString('hex') + 'Aa1';
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    `INSERT INTO employees (nik, nip, name, email, password_hash, role, position_id, location_id, active)
     VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, 1)`
  ).run('ADMIN001', 'ADMIN001', 'Administrator HCM', adminEmail, passwordHash, hcmPosition.id, defaultLocation.id);
  console.log(`Akun admin dibuat: ${adminEmail} / ${adminPassword} (harap segera ganti password setelah login pertama)`);
}

module.exports = db;
