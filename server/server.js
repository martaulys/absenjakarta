const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
require('./db'); // ensure DB initialized/seeded before routes load

const authRoutes = require('./routes/auth');
const attendanceRoutes = require('./routes/attendance');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn(
    'PERINGATAN: SESSION_SECRET tidak diset. Menggunakan secret acak sementara — ' +
      'semua sesi login akan hilang setiap kali server di-restart/redeploy. ' +
      'Set variabel lingkungan SESSION_SECRET di Railway untuk sesi yang stabil.'
  );
}

// Railway (dan PaaS lain) menempatkan app di belakang reverse proxy TLS —
// trust proxy dibutuhkan agar cookie "secure" dan req.protocol bekerja benar.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionsDir = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

app.use(
  session({
    store: new FileStore({ path: sessionsDir, logFn: () => {} }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
    },
  })
);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/admin', adminRoutes);

// Endpoint API yang tidak cocok -> 404 JSON, bukan halaman HTML
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// SPA fallback untuk route non-API (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler global — cegah stack trace bocor ke client, selalu balas JSON
app.use((err, req, res, _next) => {
  console.error(err);
  const status = err.status || 400;
  res.status(status).json({ error: err.message || 'Terjadi kesalahan pada server' });
});

app.listen(PORT, () => {
  console.log(`Absen Jakarta berjalan di port ${PORT} (${isProduction ? 'production' : 'development'})`);
});
