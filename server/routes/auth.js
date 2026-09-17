const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nowJakartaSql } = require('../utils/time');

const router = express.Router();

const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

function publicEmployee(emp) {
  return {
    id: emp.id,
    nik: emp.nik,
    nip: emp.nip,
    name: emp.name,
    email: emp.email,
    role: emp.role,
    positionId: emp.position_id,
    locationId: emp.location_id,
    positionName: emp.position_name || null,
    locationName: emp.location_name || null,
    photoPath: emp.photo_path,
    active: !!emp.active,
    joinDate: emp.created_at ? emp.created_at.split(' ')[0] : null,
  };
}

function getEmployeeWithRefs(id) {
  return db
    .prepare(
      `SELECT e.*, p.name AS position_name, l.name AS location_name
       FROM employees e
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN locations l ON l.id = e.location_id
       WHERE e.id = ?`
    )
    .get(id);
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email dan password wajib diisi' });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE email = ?').get(email.toLowerCase().trim());
  if (!emp || !bcrypt.compareSync(password, emp.password_hash)) {
    return res.status(401).json({ error: 'Email atau password salah' });
  }
  if (!emp.active) {
    return res.status(403).json({ error: 'Akun sudah non-aktif, hubungi HCM' });
  }
  req.session.employeeId = emp.id;
  req.session.role = emp.role;
  res.json({ employee: publicEmployee(getEmployeeWithRefs(emp.id)) });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  const emp = getEmployeeWithRefs(req.session.employeeId);
  if (!emp) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json({ employee: publicEmployee(emp) });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Password saat ini dan password baru wajib diisi' });
  }
  if (!PASSWORD_RULE.test(newPassword)) {
    return res.status(400).json({
      error: 'Password baru minimal 8 karakter, mengandung huruf kapital dan angka',
    });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.employeeId);
  if (!emp || !bcrypt.compareSync(currentPassword, emp.password_hash)) {
    return res.status(401).json({ error: 'Password saat ini salah' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hash, emp.id);
  db.prepare('INSERT INTO activity_log (employee_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    emp.id,
    'change_password',
    'Ubah password lewat halaman profil',
    nowJakartaSql()
  );
  res.json({ ok: true });
});

router.post('/reset-password', (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ error: 'Email dan password baru wajib diisi' });
  }
  if (!PASSWORD_RULE.test(newPassword)) {
    return res.status(400).json({
      error: 'Password minimal 8 karakter, mengandung huruf kapital dan angka',
    });
  }
  const emp = db.prepare('SELECT * FROM employees WHERE email = ?').get(email.toLowerCase().trim());
  if (!emp) {
    return res.status(404).json({ error: 'Email tidak ditemukan' });
  }
  if (!emp.active) {
    return res.status(403).json({ error: 'Akun sudah non-aktif, hubungi HCM' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hash, emp.id);
  db.prepare('INSERT INTO activity_log (employee_id, action, detail, created_at) VALUES (?, ?, ?, ?)').run(
    emp.id,
    'reset_password',
    'Reset password mandiri oleh karyawan',
    nowJakartaSql()
  );
  res.json({ ok: true });
});

module.exports = router;
