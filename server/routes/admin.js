const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { buildAttendanceWorkbook, buildEmployeeWorkbook } = require('../utils/excel');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'profile'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `profile_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

router.use(requireAdmin);

// ---- Dashboard summary ----
router.get('/summary', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const totalEmployees = db.prepare('SELECT COUNT(*) c FROM employees WHERE role = ? AND active = 1').get('employee').c;
  const checkedInToday = db
    .prepare("SELECT COUNT(DISTINCT employee_id) c FROM attendance WHERE type = 'masuk' AND timestamp LIKE ?")
    .get(`${today}%`).c;
  const pendingLeave = db.prepare("SELECT COUNT(*) c FROM leave_requests WHERE status = 'pending'").get().c;
  const fakeGpsToday = db
    .prepare('SELECT COUNT(*) c FROM attendance WHERE fake_gps_flag = 1 AND timestamp LIKE ?')
    .get(`${today}%`).c;
  res.json({ totalEmployees, checkedInToday, pendingLeave, fakeGpsToday });
});

router.get('/attendance', (req, res) => {
  const { start, end } = req.query;
  let query = `SELECT a.*, e.name, e.nik, e.nip FROM attendance a JOIN employees e ON e.id = a.employee_id`;
  const params = [];
  if (start && end) {
    query += ' WHERE date(a.timestamp) BETWEEN ? AND ?';
    params.push(start, end);
  }
  query += ' ORDER BY a.timestamp DESC LIMIT 500';
  const rows = db.prepare(query).all(...params);
  res.json({ rows });
});

// ---- Employees ----
router.get('/employees', (req, res) => {
  const rows = db
    .prepare(
      `SELECT e.*, p.name AS position_name, l.name AS location_name
       FROM employees e
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN locations l ON l.id = e.location_id
       ORDER BY e.active DESC, e.name ASC`
    )
    .all();
  res.json({ rows: rows.map(({ password_hash, ...rest }) => rest) });
});

router.post('/employees', upload.single('photo'), (req, res) => {
  const { nik, name, email, password, role, positionId } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nama, email, dan password wajib diisi' });
  }
  try {
    const photoPath = req.file ? path.join('profile', req.file.filename).replace(/\\/g, '/') : null;
    const hash = bcrypt.hashSync(password, 10);
    const defaultLocation = db.prepare('SELECT id FROM locations LIMIT 1').get();
    const result = db
      .prepare(
        `INSERT INTO employees (nik, name, email, password_hash, role, position_id, location_id, photo_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(nik || null, name, email.toLowerCase().trim(), hash, role || 'employee', positionId || null, defaultLocation ? defaultLocation.id : null, photoPath);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email sudah terdaftar' });
    }
    res.status(500).json({ error: 'Gagal menambah karyawan' });
  }
});

router.put('/employees/:id', upload.single('photo'), (req, res) => {
  const { nik, name, email, role, positionId, password } = req.body;
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  const photoPath = req.file ? path.join('profile', req.file.filename).replace(/\\/g, '/') : existing.photo_path;
  const passwordHash = password ? bcrypt.hashSync(password, 10) : existing.password_hash;

  db.prepare(
    `UPDATE employees SET nik = ?, name = ?, email = ?, role = ?, position_id = ?, photo_path = ?, password_hash = ?
     WHERE id = ?`
  ).run(
    nik || null,
    name || existing.name,
    (email || existing.email).toLowerCase().trim(),
    role || existing.role,
    positionId || null,
    photoPath,
    passwordHash,
    req.params.id
  );
  res.json({ ok: true });
});

router.post('/employees/:id/deactivate', (req, res) => {
  const { exitDate } = req.body;
  if (!exitDate) return res.status(400).json({ error: 'Tanggal keluar wajib diisi' });
  db.prepare('UPDATE employees SET active = 0, exit_date = ? WHERE id = ?').run(exitDate, req.params.id);
  res.json({ ok: true });
});

router.post('/employees/:id/reactivate', (req, res) => {
  db.prepare('UPDATE employees SET active = 1, exit_date = NULL WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Positions ----
router.get('/positions', (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM positions ORDER BY name').all() });
});
router.post('/positions', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama jabatan wajib diisi' });
  try {
    const result = db.prepare('INSERT INTO positions (name) VALUES (?)').run(name.trim());
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(409).json({ error: 'Jabatan sudah ada' });
  }
});
router.delete('/positions/:id', (req, res) => {
  db.prepare('DELETE FROM positions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Locations ----
router.get('/locations', (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM locations ORDER BY name').all() });
});
router.post('/locations', (req, res) => {
  const { name, lat, lng, radiusMeters } = req.body;
  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Nama dan koordinat wajib diisi' });
  }
  const result = db
    .prepare('INSERT INTO locations (name, lat, lng, radius_meters) VALUES (?, ?, ?, ?)')
    .run(name.trim(), parseFloat(lat), parseFloat(lng), parseInt(radiusMeters, 10) || 150);
  res.json({ id: result.lastInsertRowid });
});
router.put('/locations/:id', (req, res) => {
  const { name, lat, lng, radiusMeters } = req.body;
  db.prepare('UPDATE locations SET name = ?, lat = ?, lng = ?, radius_meters = ? WHERE id = ?').run(
    name,
    parseFloat(lat),
    parseFloat(lng),
    parseInt(radiusMeters, 10) || 150,
    req.params.id
  );
  res.json({ ok: true });
});
router.delete('/locations/:id', (req, res) => {
  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Activity log ----
router.get('/activity-log', (req, res) => {
  const rows = db
    .prepare(
      `SELECT al.*, e.name FROM activity_log al LEFT JOIN employees e ON e.id = al.employee_id
       ORDER BY al.created_at DESC LIMIT 200`
    )
    .all();
  res.json({ rows });
});

// ---- Excel export ----
router.get('/export/attendance', async (req, res) => {
  const { start, end } = req.query;
  let attendanceQuery = `SELECT a.*, e.name, e.nik, e.nip FROM attendance a JOIN employees e ON e.id = a.employee_id`;
  let leaveQuery = `SELECT lr.*, e.name, e.nik, e.nip FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id`;
  const params = [];
  if (start && end) {
    attendanceQuery += ' WHERE date(a.timestamp) BETWEEN ? AND ?';
    leaveQuery += ' WHERE lr.start_date <= ? AND lr.end_date >= ?';
    params.push(start, end);
  }
  attendanceQuery += ' ORDER BY a.timestamp DESC';
  leaveQuery += ' ORDER BY lr.start_date DESC';

  const attendanceRows = db.prepare(attendanceQuery).all(...(start && end ? [start, end] : []));
  const leaveRows = db.prepare(leaveQuery).all(...(start && end ? [end, start] : []));

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const workbook = await buildAttendanceWorkbook({ attendanceRows, leaveRows, baseUrl });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="riwayat-absen.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

router.get('/export/employees', async (req, res) => {
  const employees = db
    .prepare(
      `SELECT e.*, p.name AS position_name, l.name AS location_name
       FROM employees e
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN locations l ON l.id = e.location_id
       ORDER BY e.active DESC, e.name ASC`
    )
    .all();
  const workbook = await buildEmployeeWorkbook({ employees });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="data-karyawan.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

module.exports = router;
