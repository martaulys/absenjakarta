const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { evaluateFakeGps, lookupIpLocation } = require('../utils/fakeGps');
const { parseDeviceInfo, getClientIp } = require('../utils/deviceInfo');
const { nowJakartaSql } = require('../utils/time');

const router = express.Router();

const SHARED_DEVICE_WINDOW_MINUTES = 15;

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'attendance'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `att_${req.session.employeeId}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('File harus berupa gambar'));
    cb(null, true);
  },
});

router.get('/locations', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, name FROM locations ORDER BY name').all();
  res.json({ rows });
});

router.post('/check-in', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { type, lat, lng, accuracy, note, address, locationId, geoApiSuspicious, lat2, lng2, sampleElapsedMs } = req.body;
    if (!['masuk', 'pulang'].includes(type)) {
      return res.status(400).json({ error: 'Jenis absen tidak valid' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Foto wajib diambil' });
    }
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Lokasi GPS wajib tersedia' });
    }
    if (locationId === undefined || locationId === '') {
      return res.status(400).json({ error: 'Lokasi wajib dipilih' });
    }

    const locations = db.prepare('SELECT * FROM locations').all();
    const selectedLocation = locationId ? locations.find((l) => String(l.id) === String(locationId)) || null : null;

    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.employeeId);
    const lastAttendance = db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(emp.id);
    const recentOwnAttendance = db
      .prepare('SELECT lat, lng, timestamp FROM attendance WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 10')
      .all(emp.id);

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const parsedAccuracy = accuracy !== undefined && accuracy !== '' ? parseFloat(accuracy) : null;

    const clientIp = getClientIp(req);
    const deviceInfo = parseDeviceInfo(req.headers['user-agent']);
    const ipLocation = await lookupIpLocation(clientIp);

    let sample2 = null;
    if (lat2 !== undefined && lng2 !== undefined && lat2 !== '' && lng2 !== '') {
      sample2 = {
        lat: parseFloat(lat2),
        lng: parseFloat(lng2),
        elapsedMs: sampleElapsedMs !== undefined ? parseFloat(sampleElapsedMs) : 0,
      };
    }

    // Same IP + same device fingerprint used by a *different* employee minutes ago = likely buddy-punching
    let sharedDeviceOtherEmployee = null;
    if (clientIp) {
      const windowStart = new Date(Date.now() - SHARED_DEVICE_WINDOW_MINUTES * 60000);
      const windowStartSql = windowStart
        .toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' })
        .replace('T', ' ');
      const other = db
        .prepare(
          `SELECT a.timestamp, e.name FROM attendance a
           JOIN employees e ON e.id = a.employee_id
           WHERE a.ip_address = ? AND a.device_info = ? AND a.employee_id != ? AND a.timestamp >= ?
           ORDER BY a.timestamp DESC LIMIT 1`
        )
        .get(clientIp, deviceInfo, emp.id, windowStartSql);
      if (other) {
        const minutesAgo = (Date.now() - new Date(other.timestamp + '+07:00').getTime()) / 60000;
        sharedDeviceOtherEmployee = { employeeName: other.name, minutesAgo: Math.max(0, minutesAgo) };
      }
    }

    const { flagged, reasons, distanceFromLocation, riskScore } = evaluateFakeGps({
      lat: parsedLat,
      lng: parsedLng,
      accuracy: parsedAccuracy,
      selectedLocation,
      lastAttendance,
      recentOwnAttendance,
      geoApiSuspicious: geoApiSuspicious === 'true' || geoApiSuspicious === true,
      ipLocation,
      sample2,
      sharedDeviceOtherEmployee,
    });

    const relativePath = path.join('attendance', req.file.filename).replace(/\\/g, '/');
    const reviewStatus = flagged ? 'needs_review' : 'ok';
    const locationLabel = selectedLocation ? selectedLocation.name : 'Lain-lain';

    const result = db
      .prepare(
        `INSERT INTO attendance (employee_id, type, timestamp, lat, lng, accuracy, distance_from_location, photo_path, note, fake_gps_flag, fake_gps_reasons, device_info, ip_address, risk_score, review_status, location_id, location_label, address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        emp.id,
        type,
        nowJakartaSql(),
        parsedLat,
        parsedLng,
        parsedAccuracy,
        distanceFromLocation,
        relativePath,
        (note || '').trim(),
        flagged ? 1 : 0,
        reasons.join('; '),
        deviceInfo,
        clientIp,
        riskScore,
        reviewStatus,
        selectedLocation ? selectedLocation.id : null,
        locationLabel,
        (address || '').trim() || null
      );

    res.json({
      id: result.lastInsertRowid,
      flagged,
      reasons,
      distanceFromLocation,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Gagal menyimpan absensi' });
  }
});

// Antrian verifikasi untuk Atasan: absen anak buah (supervisor_id = user login) yang perlu/​sudah ditinjau
router.get('/pending-review', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, e.name, e.nik, e.nip FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE e.supervisor_id = ?
       ORDER BY (a.review_status = 'needs_review') DESC, a.timestamp DESC
       LIMIT 200`
    )
    .all(req.session.employeeId);
  res.json({ rows });
});

router.post('/review/:id', requireAuth, (req, res) => {
  const { status, note } = req.body;
  if (!['verified', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status verifikasi tidak valid' });
  }
  if (!note || !note.trim()) {
    return res.status(400).json({ error: 'Catatan alasan wajib diisi oleh Atasan' });
  }
  const row = db
    .prepare(
      `SELECT a.*, e.supervisor_id, e.name FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE a.id = ?`
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Data absen tidak ditemukan' });
  if (row.supervisor_id !== req.session.employeeId) {
    return res.status(403).json({ error: 'Anda bukan Atasan dari karyawan ini' });
  }

  db.prepare(
    'UPDATE attendance SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?'
  ).run(status, req.session.employeeId, nowJakartaSql(), note.trim(), req.params.id);
  db.prepare('INSERT INTO activity_log (employee_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    req.session.employeeId,
    status === 'verified' ? 'verify_attendance' : 'reject_attendance',
    `Absen #${row.id} (${row.name}, ${row.timestamp}) ditandai ${status === 'verified' ? 'terverifikasi' : 'ditolak'} oleh Atasan. Catatan: ${note.trim()}`,
    nowJakartaSql()
  );
  res.json({ ok: true });
});

router.get('/history', requireAuth, (req, res) => {
  const { start, end } = req.query;
  let query = 'SELECT * FROM attendance WHERE employee_id = ?';
  const params = [req.session.employeeId];
  if (start && end) {
    query += ' AND date(timestamp) BETWEEN ? AND ?';
    params.push(start, end);
  }
  query += ' ORDER BY timestamp DESC LIMIT 200';
  const rows = db.prepare(query).all(...params);
  res.json({ rows });
});

module.exports = router;
