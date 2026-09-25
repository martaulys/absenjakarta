const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const { nowJakartaSql } = require('./utils/time');

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
  tier TEXT NOT NULL DEFAULT 'staff', -- 'atasan' | 'staff'
  supervisor_id INTEGER REFERENCES employees(id),
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
  note TEXT NOT NULL DEFAULT '',
  fake_gps_flag INTEGER NOT NULL DEFAULT 0,
  fake_gps_reasons TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER REFERENCES employees(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY, -- 'YYYY-MM-DD'
  name TEXT
);
`);

// Fitur Izin/Sakit dihapus - webapp ini hanya untuk absen masuk/pulang
db.exec('DROP TABLE IF EXISTS leave_requests');

// Migrations for columns added after initial release
const attendanceColumns = db.prepare("PRAGMA table_info(attendance)").all().map((c) => c.name);
if (!attendanceColumns.includes('device_info')) {
  db.exec('ALTER TABLE attendance ADD COLUMN device_info TEXT');
}
if (!attendanceColumns.includes('ip_address')) {
  db.exec('ALTER TABLE attendance ADD COLUMN ip_address TEXT');
}
if (!attendanceColumns.includes('risk_score')) {
  db.exec('ALTER TABLE attendance ADD COLUMN risk_score INTEGER NOT NULL DEFAULT 0');
}
if (!attendanceColumns.includes('review_status')) {
  // 'ok' | 'needs_review' | 'verified' | 'rejected'
  db.exec("ALTER TABLE attendance ADD COLUMN review_status TEXT NOT NULL DEFAULT 'ok'");
}
if (!attendanceColumns.includes('reviewed_by')) {
  db.exec('ALTER TABLE attendance ADD COLUMN reviewed_by INTEGER REFERENCES employees(id)');
}
if (!attendanceColumns.includes('reviewed_at')) {
  db.exec('ALTER TABLE attendance ADD COLUMN reviewed_at TEXT');
}
if (!attendanceColumns.includes('location_id')) {
  db.exec('ALTER TABLE attendance ADD COLUMN location_id INTEGER REFERENCES locations(id)');
}
if (!attendanceColumns.includes('location_label')) {
  db.exec('ALTER TABLE attendance ADD COLUMN location_label TEXT');
}
if (!attendanceColumns.includes('address')) {
  db.exec('ALTER TABLE attendance ADD COLUMN address TEXT');
}
if (!attendanceColumns.includes('review_note')) {
  db.exec('ALTER TABLE attendance ADD COLUMN review_note TEXT');
}

const employeeColumns = db.prepare('PRAGMA table_info(employees)').all().map((c) => c.name);
if (!employeeColumns.includes('tier')) {
  db.exec("ALTER TABLE employees ADD COLUMN tier TEXT NOT NULL DEFAULT 'staff'");
}
if (!employeeColumns.includes('supervisor_id')) {
  db.exec('ALTER TABLE employees ADD COLUMN supervisor_id INTEGER REFERENCES employees(id)');
}

// Seed default data on first run
const positionCount = db.prepare('SELECT COUNT(*) AS c FROM positions').get().c;
if (positionCount === 0) {
  const insertPos = db.prepare('INSERT INTO positions (name) VALUES (?)');
  ['Staff', 'Supervisor', 'Manager', 'HCM'].forEach((p) => insertPos.run(p));
}

const locationCount = db.prepare('SELECT COUNT(*) AS c FROM locations').get().c;
if (locationCount === 0) {
  const insertLoc = db.prepare('INSERT INTO locations (name, lat, lng, radius_meters) VALUES (?, ?, ?, ?)');
  insertLoc.run('Kantor Jakarta', -6.2088, 106.8456, 150);
  insertLoc.run('Kantor Bandung', -6.8967, 107.6168, 150);
}

const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'hcm@tritronik.com';
const admin = db.prepare('SELECT id FROM employees WHERE email = ?').get(adminEmail);
if (!admin) {
  const defaultLocation = db.prepare('SELECT id FROM locations LIMIT 1').get();
  const hcmPosition = db.prepare("SELECT id FROM positions WHERE name = 'HCM'").get();
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || crypto.randomBytes(6).toString('hex') + 'Aa1';
  const passwordHash = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    `INSERT INTO employees (nik, nip, name, email, password_hash, role, position_id, location_id, active, created_at)
     VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, 1, ?)`
  ).run('ADMIN001', 'ADMIN001', 'Administrator HCM', adminEmail, passwordHash, hcmPosition.id, defaultLocation.id, nowJakartaSql());
  console.log(`Akun admin dibuat: ${adminEmail} / ${adminPassword} (harap segera ganti password setelah login pertama)`);
}

module.exports = db;
