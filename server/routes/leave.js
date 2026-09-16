const express = require('express');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'proof'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `proof_${req.session.employeeId}_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

router.post('/', requireAuth, upload.single('proof'), (req, res) => {
  const { type, startDate, endDate, reason } = req.body;
  if (!['izin', 'sakit'].includes(type)) {
    return res.status(400).json({ error: 'Jenis pengajuan tidak valid' });
  }
  if (!startDate || !endDate || !reason || !reason.trim()) {
    return res.status(400).json({ error: 'Tanggal dan alasan wajib diisi' });
  }
  if (new Date(endDate) < new Date(startDate)) {
    return res.status(400).json({ error: 'Tanggal selesai tidak boleh sebelum tanggal mulai' });
  }
  const proofPath = req.file ? path.join('proof', req.file.filename).replace(/\\/g, '/') : null;
  const result = db
    .prepare(
      `INSERT INTO leave_requests (employee_id, type, start_date, end_date, reason, proof_path)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.session.employeeId, type, startDate, endDate, reason.trim(), proofPath);
  res.json({ id: result.lastInsertRowid });
});

router.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC')
    .all(req.session.employeeId);
  res.json({ rows });
});

router.get('/all', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT lr.*, e.name, e.nik, e.nip FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       ORDER BY lr.created_at DESC`
    )
    .all();
  res.json({ rows });
});

router.post('/:id/review', requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }
  db.prepare(
    'UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?'
  ).run(status, req.session.employeeId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
