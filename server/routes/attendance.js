const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { evaluateFakeGps } = require('../utils/fakeGps');

const router = express.Router();

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

router.post('/check-in', requireAuth, upload.single('photo'), (req, res) => {
  try {
    const { type, lat, lng, accuracy, note } = req.body;
    if (!['masuk', 'pulang'].includes(type)) {
      return res.status(400).json({ error: 'Jenis absen tidak valid' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Foto wajib diambil' });
    }
    if (!note || !note.trim()) {
      return res.status(400).json({ error: 'Catatan wajib diisi' });
    }
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Lokasi GPS wajib tersedia' });
    }

    const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.employeeId);
    const locations = db.prepare('SELECT * FROM locations').all();
    const lastAttendance = db
      .prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(emp.id);

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const parsedAccuracy = accuracy !== undefined && accuracy !== '' ? parseFloat(accuracy) : null;

    const { flagged, reasons, distanceFromLocation } = evaluateFakeGps({
      lat: parsedLat,
      lng: parsedLng,
      accuracy: parsedAccuracy,
      locations,
      lastAttendance,
    });

    const relativePath = path.join('attendance', req.file.filename).replace(/\\/g, '/');

    const result = db
      .prepare(
        `INSERT INTO attendance (employee_id, type, lat, lng, accuracy, distance_from_location, photo_path, note, fake_gps_flag, fake_gps_reasons)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        emp.id,
        type,
        parsedLat,
        parsedLng,
        parsedAccuracy,
        distanceFromLocation,
        relativePath,
        note.trim(),
        flagged ? 1 : 0,
        reasons.join('; ')
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

router.get('/history', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM attendance WHERE employee_id = ? ORDER BY timestamp DESC LIMIT 100')
    .all(req.session.employeeId);
  res.json({ rows });
});

module.exports = router;
