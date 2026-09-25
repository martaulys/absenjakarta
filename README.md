# Absen Lokasi Jakarta — Tritronik

Aplikasi absensi karyawan berbasis web mandiri (Node.js/Express + SQLite) untuk absen masuk/pulang, dengan foto kehadiran, deteksi lokasi, heuristik anti-fake-GPS, dan dashboard admin.

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
- Absen masuk/pulang: foto langsung dari kamera (wajib), deteksi lokasi GPS, pemilihan **Lokasi** dari daftar lokasi kantor terdaftar (atau **Lain-lain** untuk lokasi di luar kantor), dan Catatan yang **selalu tersedia namun opsional** (tidak wajib diisi apa pun lokasi yang dipilih)
- Multi-lokasi kantor (mis. Jakarta & Bandung) — validasi radius & jarak dilakukan terhadap lokasi yang **dipilih langsung oleh karyawan** saat absen, bukan sekadar lokasi terdekat
- Deteksi mock-location berbasis skor multi-sinyal (server-side, tidak bisa dipengaruhi client): akurasi GPS rendah/tidak ada/statis berulang, koordinat identik persis dengan titik kantor atau absen sebelumnya (GPS asli selalu punya jitter kecil), dua pembacaan GPS berturut-turut tanpa variasi alami, kecepatan perpindahan tidak masuk akal, di luar radius lokasi kantor yang dipilih, API geolocation browser terindikasi dimodifikasi, lokasi dari alamat IP yang jauh berbeda dari koordinat GPS, serta perangkat/IP yang sama dipakai beberapa karyawan berbeda dalam waktu berdekatan (indikasi titip absen). Hasil ditampilkan sebagai **Terindikasi** (lengkap dengan daftar alasan, tanpa skor mentah) atau **Normal**
- **Jabatan vs Jobtitle dipisah**: **Jabatan** adalah jenjang struktural karyawan (**Staff**/**Supervisor**) yang menentukan alur verifikasi; **Jobtitle** adalah sebutan pekerjaan sehari-hari (Staff, Supervisor, Manager, HCM, dst — dikelola lewat Kelola Jobtitle) dan tidak memengaruhi alur verifikasi. Kebetulan keduanya bisa sama-sama punya nilai "Staff"/"Supervisor", tapi keduanya field yang independen
- **Alur verifikasi berjenjang ke Supervisor**: akun ber-Jabatan **Staff** menunjuk satu **Supervisor** (sesama karyawan ber-Jabatan Supervisor) lewat Kelola Karyawan. Absen yang terindikasi mencurigakan otomatis masuk ke tab **Verifikasi** milik Supervisor karyawan tsb (bukan cuma ke admin) untuk ditandai Terverifikasi/Ditolak — **Supervisor wajib mengisi Catatan alasan** setiap kali memverifikasi/menolak. Admin (HCM) tetap bisa melakukan override lewat Riwayat Absensi dengan catatan yang sama wajibnya, dan semuanya tercatat di Log Aktivitas
- Riwayat Absensi mencatat jenis perangkat (OS + browser) dan alamat IP setiap absen, terlihat oleh karyawan (riwayat sendiri, dengan filter tanggal) dan admin (semua karyawan, dengan filter Nama dan Tanggal via tombol Filter)
- Semua waktu absen/aktivitas dicatat dalam zona waktu Jakarta (WIB/UTC+7), konsisten dengan jam yang tampil di halaman absen
- Lokasi kerja (mis. Jakarta/Bandung) dapat diatur admin per karyawan lewat Kelola Karyawan
- Kelola Hari Libur: Sabtu/Minggu otomatis dianggap libur; admin dapat menambah tanggal merah lain satu per satu atau **import Excel** untuk daftar tanggal merah satu tahun sekaligus
- Reset password mandiri ("Lupa password?") dengan aturan minimal 8 karakter + huruf kapital + angka, tercatat di log aktivitas admin
- Dashboard admin: ringkasan, riwayat absensi (filter Nama & tanggal), kelola karyawan (tambah/edit/nonaktifkan dengan tanggal keluar, Jabatan Staff/Supervisor, dan penunjukan Supervisor), kelola lokasi kantor, kelola Jobtitle, kelola hari libur, log aktivitas
- Unduh Riwayat Absen ke Excel: satu baris per karyawan per tanggal dalam rentang yang dipilih (default bulan berjalan), kolom Nama, NIK, Tanggal (format "Hari, dd/mm/yyyy"), Jam Absen Masuk, Jam Absen Pulang, Lokasi, Catatan, **Alamat** (hasil deteksi reverse-geocoding saat absen, baik untuk absen normal maupun terindikasi — menggantikan Latitude/Longitude mentah), Bukti Foto, Status. Sabtu/Minggu dan tanggal merah ditandai merah satu baris penuh; jika absen masuk atau pulang tidak ada pada hari kerja, kolom Tanggal dan kolom jam yang kosong ditandai merah. Data karyawan juga bisa diunduh terpisah (dengan status aktif/non-aktif)

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

- Heuristik fake-GPS bersifat indikatif (bukan bukti mutlak) — hasil "terindikasi" tetap tersimpan di riwayat untuk ditinjau Supervisor (atau admin), absen tidak diblokir otomatis.
- Kamera & geolokasi browser memerlukan koneksi HTTPS (atau `localhost`) agar `getUserMedia`/`Geolocation` API berfungsi.
- Keterangan alamat pada kamera absen menggunakan layanan reverse-geocoding gratis (OpenStreetMap Nominatim) — tanpa API key, tapi bergantung pada ketersediaan layanan pihak ketiga tersebut dan dibatasi ~1 permintaan/detik (cukup untuk pola pemakaian absen normal).
- Deteksi mock-location memakai layanan IP geolocation gratis (ip-api.com, tanpa API key) sebagai pembanding non-blocking — jika layanan gagal/limit, absen tetap diproses normal tanpa pengecekan ini (fail-open, bukan bug).
- Deteksi "API geolocation dimodifikasi" adalah heuristik client-side sederhana (memeriksa apakah `navigator.geolocation` masih kode native browser) — bisa dilewati oleh spoofer yang lebih canggih, jadi tetap bersifat indikatif seperti heuristik fake-GPS lainnya.
