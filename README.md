# Absen Lokasi Jakarta — Tritronik

Aplikasi absensi karyawan berbasis web mandiri (Node.js/Express + SQLite), dengan foto kehadiran, deteksi lokasi, heuristik anti-fake-GPS, pengajuan izin, dan dashboard admin.

Aplikasi ini **standalone** — tidak lagi bergantung pada `window.claude` (Claude Artifact API). Semua data, foto, dan file Excel diproses oleh server Node.js sendiri.

## Menjalankan secara lokal

Membutuhkan **Node.js 22.5 atau lebih baru**.

```bash
npm install
npm start
```

Buka `http://localhost:3001` (atau port sesuai variabel `PORT`).

Akun admin default dibuat otomatis saat pertama kali dijalankan (jika belum ada akun dengan email tersebut):
- Email: `hcm@tritronik.com` (bisa diubah lewat `ADMIN_DEFAULT_EMAIL`)
- Password: acak, **dicetak sekali ke log server saat pertama kali dijalankan** (bisa dipaksa lewat `ADMIN_DEFAULT_PASSWORD`)

**Segera ganti password admin default ini setelah login pertama** (lewat menu Profil, atau via "Lupa password?").

## Variabel lingkungan (environment variables)

| Variabel | Wajib? | Keterangan |
|---|---|---|
| `PORT` | Tidak | Port server. Railway mengisi otomatis. Default lokal: `3001`. |
| `SESSION_SECRET` | **Ya, di produksi** | Kunci rahasia untuk menandatangani cookie sesi. Jika tidak diset, server memakai secret acak sementara (login akan ter-reset tiap restart/redeploy) — set nilai tetap yang panjang & acak di Railway. |
| `NODE_ENV` | Tidak | Set `production` di Railway agar cookie sesi memakai flag `Secure` dan warning dev disembunyikan. |
| `ADMIN_DEFAULT_EMAIL` | Tidak | Override email akun admin awal (default `hcm@tritronik.com`). |
| `ADMIN_DEFAULT_PASSWORD` | Tidak | Override password akun admin awal. Jika tidak diset, password acak dibuat dan dicetak sekali ke log. |

## Fitur

- Login karyawan per akun (email + password), dengan akun admin khusus
- Absen masuk/pulang: foto langsung dari kamera (wajib), deteksi lokasi GPS, catatan wajib
- Multi-lokasi kantor (mis. Jakarta & Bandung) — saat absen, sistem mencari lokasi kantor **terdekat** dari seluruh daftar di Kelola Lokasi, bukan hanya satu lokasi yang di-assign ke karyawan
- Heuristik deteksi indikasi fake GPS: akurasi GPS rendah/tidak ada, lompatan lokasi tidak wajar antar absen, di luar radius lokasi kantor terdekat yang terdaftar — hasil "terindikasi" langsung terlihat admin di Riwayat Absensi, Ringkasan, dan export Excel
- Pengajuan izin/sakit dengan rentang tanggal dan unggah bukti (surat sakit/acc atasan)
- Reset password mandiri ("Lupa password?") dengan aturan minimal 8 karakter + huruf kapital + angka, tercatat di log aktivitas admin
- Dashboard admin: ringkasan, riwayat absensi (filter tanggal), kelola karyawan (tambah/edit/nonaktifkan dengan tanggal keluar), kelola lokasi kantor, kelola jabatan, log aktivitas
- Unduh data ke Excel: absensi+izin (dengan filter tanggal) dan data karyawan (dengan status aktif/non-aktif), dengan pewarnaan sel via ExcelJS

## Arsitektur

- **Backend**: Node.js + Express, dijalankan dengan flag `--experimental-sqlite` (lihat skrip `start`/`build` di `package.json`)
- **Sesi login**: `express-session` dengan `session-file-store` (disimpan sebagai file JSON di `data/sessions/`, bukan in-memory) — bertahan lintas restart selama volume `data/` persisten. Password di-hash dengan `bcryptjs`.
- **Database**: SQLite via modul bawaan Node `node:sqlite`, file di `data/absensi.db` (dibuat otomatis, tanpa dependensi native/kompilasi)
- **Upload foto/bukti**: disimpan di disk lokal (`server/uploads/`), disajikan lewat `/uploads/...`
- **Export Excel**: `exceljs`

## Catatan penting untuk deploy (Railway atau hosting lain)

Railway (dan kebanyakan PaaS berbasis container) menggunakan **filesystem sementara (ephemeral)** secara default — folder `data/` (database + sesi login) dan `server/uploads/` (foto) akan **hilang setiap kali di-redeploy** kecuali Anda memasang **volume persisten**:

1. Di Railway, tambahkan sebuah **Volume** dan mount ke `/app/data` (mencakup database dan sesi login) serta `/app/server/uploads` (foto).
2. Set variabel lingkungan `SESSION_SECRET` (string acak panjang) dan `NODE_ENV=production` di dashboard Railway.
3. Alternatif jangka panjang: migrasi ke database eksternal (PostgreSQL milik Railway) dan object storage (S3/Cloudinary) untuk foto — ini pengembangan lanjutan, beri tahu jika dibutuhkan.

Untuk penggunaan kantor skala kecil-menengah dengan volume terpasang, setup SQLite + disk lokal saat ini sudah cukup. `railway.json` sudah mengatur `startCommand`, health check (`/`), dan restart policy secara otomatis.

## Batasan yang perlu diketahui

- Heuristik fake-GPS bersifat indikatif (bukan bukti mutlak) — hasil "terindikasi" tetap tersimpan di riwayat untuk ditinjau admin, absen tidak diblokir otomatis.
- Kamera & geolokasi browser memerlukan koneksi HTTPS (atau `localhost`) agar `getUserMedia`/`Geolocation` API berfungsi.
- Keterangan alamat pada kamera absen menggunakan layanan reverse-geocoding gratis (OpenStreetMap Nominatim) — tanpa API key, tapi bergantung pada ketersediaan layanan pihak ketiga tersebut dan dibatasi ~1 permintaan/detik (cukup untuk pola pemakaian absen normal).
