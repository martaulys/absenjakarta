const state = {
  employee: null,
  capturedBlob: null,
  currentPosition: null,
  secondPosition: null,
  locationAddress: null,
  geoApiSuspicious: false,
  positions: [],
  locations: [],
  editingEmployeeId: null,
  deactivatingEmployeeId: null,
};

function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Terjadi kesalahan');
  return data;
}

function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (msg) el.textContent = msg;
  el.classList.remove('hidden');
}
function hideFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
}

// ---------------- PASSWORD RULE VALIDATION ----------------
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

function isPasswordValid(password) {
  return PASSWORD_RULE.test(password);
}

// Wire live validation + eye-icon toggle for every "password baru" field that has a matching *-rule-error element
document.querySelectorAll('.password-field input[type="password"]').forEach((input) => {
  const ruleErrorEl = document.getElementById(input.id + '-rule-error');
  if (ruleErrorEl) {
    input.addEventListener('input', () => {
      if (!input.value) return hideFieldError(ruleErrorEl.id);
      if (isPasswordValid(input.value)) hideFieldError(ruleErrorEl.id);
      else showFieldError(ruleErrorEl.id);
    });
  }
});

// ---------------- AUTH ----------------
document.getElementById('btn-show-forgot').onclick = () => showView('view-forgot');
document.getElementById('btn-back-login').onclick = () => showView('view-login');

document.getElementById('form-login').onsubmit = async (e) => {
  e.preventDefault();
  hideFieldError('login-error');
  try {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { employee } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    state.employee = employee;
    enterApp();
  } catch (err) {
    showFieldError('login-error', err.message);
  }
};

document.getElementById('form-forgot').onsubmit = async (e) => {
  e.preventDefault();
  hideFieldError('forgot-error');
  try {
    const email = document.getElementById('forgot-email').value;
    const newPassword = document.getElementById('forgot-password').value;
    const confirmPassword = document.getElementById('forgot-password-confirm').value;
    if (!isPasswordValid(newPassword)) {
      return showFieldError('forgot-password-rule-error');
    }
    if (newPassword !== confirmPassword) {
      return showFieldError('forgot-error', 'Password baru dan ulangi password tidak sama');
    }
    await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, newPassword }) });
    toast('Password berhasil direset, silakan login');
    e.target.reset();
    showView('view-login');
  } catch (err) {
    showFieldError('forgot-error', err.message);
  }
};

document.getElementById('btn-logout-emp').onclick = doLogout;
document.getElementById('btn-logout-admin').onclick = doLogout;
async function doLogout() {
  await api('/auth/logout', { method: 'POST' });
  state.employee = null;
  showView('view-login');
}

async function enterApp() {
  if (state.employee.role === 'admin') {
    document.getElementById('admin-name').textContent = state.employee.name;
    showView('view-admin');
    await loadAdminRefData();
    loadSummary();
    loadAttendanceAdmin();
  } else {
    document.getElementById('emp-name').textContent = state.employee.name;
    showView('view-employee');
    loadHistory();
    loadMyLeave();
    startClock();
    updateAbsenButtonsState();
  }
}

(async function init() {
  try {
    const { employee } = await api('/auth/me');
    state.employee = employee;
    enterApp();
  } catch {
    showView('view-login');
  }
})();

// ---------------- EMPLOYEE TABS ----------------
document.querySelectorAll('#view-employee .tab-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('#view-employee .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('#view-employee .tab-content').forEach((c) => c.classList.add('hidden'));
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'profil') loadProfile();
  };
});

// ---------------- CLOCK (Waktu Jakarta) ----------------
function startClock() {
  const el = document.getElementById('clock-display');
  if (!el || el.dataset.started) return;
  el.dataset.started = '1';
  function tick() {
    const now = new Date();
    const dayDate = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
    const time =
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now) + ' WIB';
    el.innerHTML = `<div class="clock-day-date">${dayDate}</div><div class="clock-time">${time}</div>`;
  }
  tick();
  setInterval(tick, 1000);
}

// ---------------- CAMERA ----------------
let mediaStream = null;
let cameraOverlayInterval = null;

document.getElementById('btn-start-camera').onclick = async () => {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    const video = document.getElementById('camera-preview');
    video.srcObject = mediaStream;
    video.classList.remove('hidden');
    document.getElementById('captured-photo').classList.add('hidden');
    document.getElementById('btn-start-camera').classList.add('hidden');
    document.getElementById('btn-capture').classList.remove('hidden');
    document.getElementById('camera-location-overlay').classList.remove('hidden');
    startCameraOverlayClock();
    requestLocation();
  } catch (err) {
    toast('Tidak bisa mengakses kamera: ' + err.message, true);
  }
};

function startCameraOverlayClock() {
  if (cameraOverlayInterval) return;
  const tick = () => {
    const el = document.getElementById('camera-datetime');
    if (el) {
      el.textContent = new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
    }
  };
  tick();
  cameraOverlayInterval = setInterval(tick, 1000);
}

function stopCameraOverlayClock() {
  if (cameraOverlayInterval) {
    clearInterval(cameraOverlayInterval);
    cameraOverlayInterval = null;
  }
}

async function reverseGeocode(lat, lng) {
  const addressEl = document.getElementById('camera-address-line');
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { Accept: 'application/json' } }
    );
    const data = await res.json();
    state.locationAddress = data.display_name || null;
  } catch {
    state.locationAddress = null;
  }
  if (addressEl) addressEl.textContent = state.locationAddress || 'Alamat tidak dapat dideteksi';
}

document.getElementById('btn-capture').onclick = () => {
  const video = document.getElementById('camera-preview');
  const canvas = document.getElementById('camera-canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  drawLocationStampOnCanvas(ctx, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    state.capturedBlob = blob;
    const img = document.getElementById('captured-photo');
    img.src = URL.createObjectURL(blob);
    img.classList.remove('hidden');
    video.classList.add('hidden');
    document.getElementById('btn-capture').classList.add('hidden');
    document.getElementById('btn-retake').classList.remove('hidden');
    updateAbsenButtonsState();
  }, 'image/jpeg', 0.9);
};

function drawLocationStampOnCanvas(ctx, width, height) {
  const dateTimeText = document.getElementById('camera-datetime').textContent;
  const coordsText = document.getElementById('camera-coords').textContent;
  const addressText = document.getElementById('camera-address-line').textContent;

  const padding = Math.round(width * 0.02);
  const fontSize = Math.max(12, Math.round(width * 0.032));
  const lineHeight = fontSize * 1.35;
  const barHeight = lineHeight * 2 + padding * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, height - barHeight, width, barHeight);

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  ctx.fillText(addressText, padding, height - barHeight + padding, width - padding * 2);

  ctx.font = `${fontSize * 0.85}px Arial, sans-serif`;
  ctx.fillText(`${coordsText}   ${dateTimeText}`, padding, height - barHeight + padding + lineHeight, width - padding * 2);
}

document.getElementById('btn-retake').onclick = () => {
  state.capturedBlob = null;
  document.getElementById('captured-photo').classList.add('hidden');
  document.getElementById('camera-preview').classList.remove('hidden');
  document.getElementById('btn-retake').classList.add('hidden');
  document.getElementById('btn-capture').classList.remove('hidden');
  updateAbsenButtonsState();
};

document.getElementById('absen-note').addEventListener('input', updateAbsenButtonsState);

function updateAbsenButtonsState() {
  const note = document.getElementById('absen-note').value.trim();
  const ready = !!state.capturedBlob && !!state.currentPosition && !!note;
  document.getElementById('btn-absen-masuk').disabled = !ready;
  document.getElementById('btn-absen-pulang').disabled = !ready;
}

function isGeolocationApiSuspicious() {
  try {
    // Native browser APIs stringify to "function foo() { [native code] }".
    // Extensions/scripts that override getCurrentPosition to fake coordinates
    // replace this with actual JS source, which is a strong tampering signal.
    const fn = navigator.geolocation && navigator.geolocation.getCurrentPosition;
    if (!fn || !/\[native code\]/.test(Function.prototype.toString.call(fn))) return true;
    return false;
  } catch {
    return true;
  }
}

function requestLocation() {
  const statusEl = document.getElementById('location-status');
  statusEl.textContent = 'Mendeteksi lokasi...';
  statusEl.className = 'location-status';
  if (!navigator.geolocation) {
    statusEl.textContent = 'Geolocation tidak didukung browser ini';
    statusEl.className = 'location-status warn';
    updateAbsenButtonsState();
    return;
  }
  state.geoApiSuspicious = isGeolocationApiSuspicious();
  state.secondPosition = null;
  const firstFixTime = Date.now();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.currentPosition = pos.coords;
      statusEl.textContent = `Lokasi terdeteksi (akurasi ±${Math.round(pos.coords.accuracy)}m) — memvalidasi...`;
      statusEl.className = 'location-status ok';
      const coordsEl = document.getElementById('camera-coords');
      if (coordsEl) coordsEl.textContent = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      updateAbsenButtonsState();

      // Take a 2nd reading a couple seconds later: real handheld GPS naturally drifts a
      // little between readings, while a static/injected mock location typically won't.
      setTimeout(() => {
        navigator.geolocation.getCurrentPosition(
          (pos2) => {
            state.secondPosition = { lat: pos2.coords.latitude, lng: pos2.coords.longitude, elapsedMs: Date.now() - firstFixTime };
            if (statusEl.textContent.includes('memvalidasi')) {
              statusEl.textContent = `Lokasi terdeteksi (akurasi ±${Math.round(pos.coords.accuracy)}m)`;
            }
          },
          () => {
            /* best-effort only - don't block check-in if the 2nd read fails */
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }, 2500);
    },
    (err) => {
      statusEl.textContent = 'Gagal mendapatkan lokasi: ' + err.message;
      statusEl.className = 'location-status warn';
      updateAbsenButtonsState();
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

async function submitAbsen(type) {
  try {
    if (!state.capturedBlob) return toast('Ambil foto terlebih dahulu', true);
    if (!state.currentPosition) return toast('Lokasi belum terdeteksi', true);
    const note = document.getElementById('absen-note').value;
    if (!note.trim()) return toast('Catatan wajib diisi', true);

    const fd = new FormData();
    fd.append('photo', state.capturedBlob, 'absen.jpg');
    fd.append('type', type);
    fd.append('lat', state.currentPosition.latitude);
    fd.append('lng', state.currentPosition.longitude);
    fd.append('accuracy', state.currentPosition.accuracy);
    fd.append('note', note);
    fd.append('geoApiSuspicious', state.geoApiSuspicious ? 'true' : 'false');
    if (state.secondPosition) {
      fd.append('lat2', state.secondPosition.lat);
      fd.append('lng2', state.secondPosition.lng);
      fd.append('sampleElapsedMs', state.secondPosition.elapsedMs);
    }

    const result = await api('/attendance/check-in', { method: 'POST', body: fd });
    if (result.flagged) {
      toast('Absen tersimpan, namun terindikasi lokasi mencurigakan dan perlu verifikasi admin: ' + result.reasons.join('; '), true);
    } else {
      toast('Absen berhasil disimpan');
    }
    resetAbsenForm();
    loadHistory();
  } catch (err) {
    toast(err.message, true);
  }
}
document.getElementById('btn-absen-masuk').onclick = () => submitAbsen('masuk');
document.getElementById('btn-absen-pulang').onclick = () => submitAbsen('pulang');

function resetAbsenForm() {
  state.capturedBlob = null;
  state.currentPosition = null;
  state.secondPosition = null;
  state.locationAddress = null;
  state.geoApiSuspicious = false;
  document.getElementById('absen-note').value = '';
  document.getElementById('captured-photo').classList.add('hidden');
  document.getElementById('btn-retake').classList.add('hidden');
  document.getElementById('btn-start-camera').classList.remove('hidden');
  document.getElementById('location-status').textContent = 'Lokasi belum terdeteksi';
  document.getElementById('location-status').className = 'location-status';
  document.getElementById('camera-location-overlay').classList.add('hidden');
  document.getElementById('camera-address-line').textContent = 'Mendeteksi lokasi...';
  document.getElementById('camera-coords').textContent = '';
  stopCameraOverlayClock();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  updateAbsenButtonsState();
}

async function loadHistory() {
  const { rows } = await api('/attendance/history');
  const tbody = document.querySelector('#table-riwayat tbody');
  const name = state.employee ? state.employee.name : '-';
  const nik = state.employee ? state.employee.nik || state.employee.nip || '-' : '-';
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.timestamp}</td>
        <td>${name}</td>
        <td>${nik}</td>
        <td>${r.type === 'masuk' ? 'Masuk' : 'Pulang'}</td>
        <td>${r.note}</td>
        <td>${r.fake_gps_flag ? '<span class="badge warn">Terindikasi</span>' : '<span class="badge ok">Normal</span>'}</td>
      </tr>`
    )
    .join('');
}

// ---------------- LEAVE (employee) ----------------
document.getElementById('form-leave').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const fd = new FormData();
    fd.append('type', document.getElementById('leave-type').value);
    fd.append('startDate', document.getElementById('leave-start').value);
    fd.append('endDate', document.getElementById('leave-end').value);
    fd.append('reason', document.getElementById('leave-reason').value);
    const proofFile = document.getElementById('leave-proof').files[0];
    if (proofFile) fd.append('proof', proofFile);
    await api('/leave', { method: 'POST', body: fd });
    toast('Pengajuan berhasil dikirim');
    e.target.reset();
    loadMyLeave();
  } catch (err) {
    toast(err.message, true);
  }
};

async function loadMyLeave() {
  const { rows } = await api('/leave/mine');
  const tbody = document.querySelector('#table-leave-mine tbody');
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.start_date} s.d. ${r.end_date}</td>
        <td>${r.type}</td>
        <td>${r.reason}</td>
        <td><span class="badge ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'warn' : 'pending'}">${r.status}</span></td>
      </tr>`
    )
    .join('');
}

// ---------------- PROFIL (karyawan) ----------------
function loadProfile() {
  const emp = state.employee;
  document.getElementById('profile-name').value = emp.name || '';
  document.getElementById('profile-email').value = emp.email || '';
  document.getElementById('profile-nik').value = emp.nik || '-';
  document.getElementById('profile-position').value = emp.positionName || '-';
  document.getElementById('profile-location').value = emp.locationName || '-';
  document.getElementById('profile-join-date').value = formatDateID(emp.joinDate);
}

function formatDateID(isoDate) {
  if (!isoDate) return '-';
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

document.getElementById('form-change-password').onsubmit = async (e) => {
  e.preventDefault();
  hideFieldError('cp-error');
  try {
    const currentPassword = document.getElementById('cp-current').value;
    const newPassword = document.getElementById('cp-new').value;
    if (!isPasswordValid(newPassword)) {
      return showFieldError('cp-new-rule-error');
    }
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    toast('Password berhasil diubah');
    e.target.reset();
  } catch (err) {
    showFieldError('cp-error', err.message);
  }
};

// ---------------- ADMIN TABS ----------------
document.querySelectorAll('#view-admin .tab-btn').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('#view-admin .tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('#view-admin .tab-content').forEach((c) => c.classList.add('hidden'));
    document.getElementById('atab-' + btn.dataset.atab).classList.remove('hidden');
    if (btn.dataset.atab === 'karyawan') loadEmployees();
    if (btn.dataset.atab === 'izin-admin') loadLeaveAdmin();
    if (btn.dataset.atab === 'lokasi') loadLocations();
    if (btn.dataset.atab === 'jabatan') loadPositions();
    if (btn.dataset.atab === 'aktivitas') loadActivity();
    if (btn.dataset.atab === 'ringkasan') loadSummary();
    if (btn.dataset.atab === 'profil-admin') loadAdminProfile();
  };
});

async function loadSummary() {
  const s = await api('/admin/summary');
  document.getElementById('sum-total').textContent = s.totalEmployees;
  document.getElementById('sum-checkin').textContent = s.checkedInToday;
  document.getElementById('sum-pending').textContent = s.pendingLeave;
  document.getElementById('sum-fake').textContent = s.fakeGpsToday;
  document.getElementById('sum-review').textContent = s.pendingReview;
}

const REVIEW_STATUS_BADGE = {
  needs_review: '<span class="badge warn">Perlu Verifikasi</span>',
  verified: '<span class="badge ok">Terverifikasi</span>',
  rejected: '<span class="badge warn">Ditolak</span>',
  ok: '',
};

async function loadAttendanceAdmin() {
  const start = document.getElementById('filter-start').value;
  const end = document.getElementById('filter-end').value;
  const qs = start && end ? `?start=${start}&end=${end}` : '';
  const { rows } = await api('/admin/attendance' + qs);
  const tbody = document.querySelector('#table-attendance-admin tbody');
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.timestamp}</td>
        <td>${r.name}</td>
        <td>${r.nik || r.nip || '-'}</td>
        <td>${r.type === 'masuk' ? 'Masuk' : 'Pulang'}</td>
        <td>${r.note}</td>
        <td>${r.device_info || '-'}</td>
        <td>${r.ip_address || '-'}</td>
        <td>${r.fake_gps_flag ? `<span class="badge warn" title="${(r.fake_gps_reasons || '').replace(/"/g, '&quot;')}">Terindikasi (skor ${r.risk_score})</span>` : '<span class="badge ok">Normal</span>'}</td>
        <td>
          ${REVIEW_STATUS_BADGE[r.review_status] || ''}
          ${
            r.review_status === 'needs_review'
              ? `<button data-id="${r.id}" data-action="verified" class="btn-review-att btn-secondary">Verifikasi</button>
                 <button data-id="${r.id}" data-action="rejected" class="btn-review-att btn-secondary">Tolak</button>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');
  document.querySelectorAll('.btn-review-att').forEach((btn) => {
    btn.onclick = async () => {
      try {
        await api(`/admin/attendance/${btn.dataset.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ status: btn.dataset.action }),
        });
        toast(btn.dataset.action === 'verified' ? 'Absen ditandai terverifikasi' : 'Absen ditandai ditolak');
        loadAttendanceAdmin();
        loadSummary();
      } catch (err) {
        toast(err.message, true);
      }
    };
  });
}
document.getElementById('btn-filter-attendance').onclick = loadAttendanceAdmin;
document.getElementById('btn-export-attendance').onclick = () => {
  const start = document.getElementById('filter-start').value;
  const end = document.getElementById('filter-end').value;
  const qs = start && end ? `?start=${start}&end=${end}` : '';
  window.location.href = '/api/admin/export/attendance' + qs;
};
document.getElementById('btn-export-employees').onclick = () => {
  window.location.href = '/api/admin/export/employees';
};

document.getElementById('btn-import-employees').onclick = () => {
  document.getElementById('import-employees-file').click();
};

document.getElementById('import-employees-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const fd = new FormData();
    fd.append('file', file);
    const result = await api('/admin/employees/import', { method: 'POST', body: fd });
    let msg = `Import selesai: ${result.inserted} ditambahkan, ${result.updated} diperbarui`;
    if (result.skippedAdmins) msg += `, ${result.skippedAdmins} akun admin dilewati`;
    toast(msg);
    if (result.unknownPositions && result.unknownPositions.length) {
      toast(`Jabatan tidak dikenal (dibiarkan kosong): ${result.unknownPositions.join(', ')}`, true);
    }
    if (result.errors && result.errors.length) {
      toast(`${result.errors.length} baris gagal: ${result.errors.join('; ')}`, true);
    }
    loadEmployees();
  } catch (err) {
    toast(err.message, true);
  } finally {
    e.target.value = '';
  }
});

async function loadLeaveAdmin() {
  const { rows } = await api('/leave/all');
  const tbody = document.querySelector('#table-leave-admin tbody');
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
        <td>${r.name}</td>
        <td>${r.type}</td>
        <td>${r.start_date} s.d. ${r.end_date}</td>
        <td>${r.reason}</td>
        <td>${r.proof_path ? `<a href="/uploads/${r.proof_path}" target="_blank">Lihat</a>` : '-'}</td>
        <td><span class="badge ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'warn' : 'pending'}">${r.status}</span></td>
        <td>${
          r.status === 'pending'
            ? `<button data-id="${r.id}" data-action="approved" class="btn-review btn-secondary">Setuju</button>
               <button data-id="${r.id}" data-action="rejected" class="btn-review btn-secondary">Tolak</button>`
            : '-'
        }</td>
      </tr>`
    )
    .join('');
  document.querySelectorAll('.btn-review').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/leave/${btn.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ status: btn.dataset.action }) });
      loadLeaveAdmin();
    };
  });
}

// ---------------- ADMIN: EMPLOYEES ----------------
async function loadAdminRefData() {
  const [{ rows: positions }, { rows: locations }] = await Promise.all([api('/admin/positions'), api('/admin/locations')]);
  state.positions = positions;
  state.locations = locations;
  const posSelect = document.getElementById('emp-form-position');
  posSelect.innerHTML = positions.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  const empLocSelect = document.getElementById('emp-form-location');
  empLocSelect.innerHTML = locations.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
  const admPosSelect = document.getElementById('adm-profile-position');
  admPosSelect.innerHTML = positions.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  const admLocSelect = document.getElementById('adm-profile-location');
  admLocSelect.innerHTML = locations.map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
}

async function loadEmployees() {
  const { rows } = await api('/admin/employees');
  const tbody = document.querySelector('#table-employees tbody');
  tbody.innerHTML = rows
    .map(
      (e) => `<tr>
        <td>${e.name}</td>
        <td>${e.email}</td>
        <td>${e.nik || e.nip || '-'}</td>
        <td>${e.position_name || '-'}</td>
        <td>${e.location_name || '-'}</td>
        <td>${e.active ? '<span class="badge ok">Aktif</span>' : `<span class="badge warn">Non-aktif (${e.exit_date || ''})</span>`}</td>
        <td>
          <button class="btn-secondary btn-edit-emp" data-id="${e.id}">Edit</button>
          ${
            e.active
              ? `<button class="btn-secondary btn-deactivate-emp" data-id="${e.id}">Nonaktifkan</button>`
              : `<button class="btn-secondary btn-reactivate-emp" data-id="${e.id}">Aktifkan</button>`
          }
        </td>
      </tr>`
    )
    .join('');

  document.querySelectorAll('.btn-edit-emp').forEach((btn) => {
    btn.onclick = () => openEmployeeForm(rows.find((r) => r.id == btn.dataset.id));
  });
  document.querySelectorAll('.btn-deactivate-emp').forEach((btn) => {
    btn.onclick = () => {
      state.deactivatingEmployeeId = btn.dataset.id;
      document.getElementById('modal-deactivate').classList.remove('hidden');
    };
  });
  document.querySelectorAll('.btn-reactivate-emp').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/admin/employees/${btn.dataset.id}/reactivate`, { method: 'POST' });
      loadEmployees();
    };
  });
}

document.getElementById('btn-confirm-deactivate').onclick = async () => {
  const exitDate = document.getElementById('deactivate-date').value;
  if (!exitDate) return toast('Tanggal keluar wajib diisi', true);
  await api(`/admin/employees/${state.deactivatingEmployeeId}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({ exitDate }),
  });
  document.getElementById('modal-deactivate').classList.add('hidden');
  loadEmployees();
};
document.getElementById('btn-cancel-deactivate').onclick = () => {
  document.getElementById('modal-deactivate').classList.add('hidden');
};

document.getElementById('btn-add-employee').onclick = () => openEmployeeForm(null);
document.getElementById('btn-cancel-employee').onclick = () => {
  document.getElementById('employee-form-card').classList.add('hidden');
};

async function openEmployeeForm(emp) {
  await loadAdminRefData(); // pastikan daftar jabatan/lokasi terbaru sebelum form dibuka
  state.editingEmployeeId = emp ? emp.id : null;
  document.getElementById('employee-form-title').textContent = emp ? 'Edit Karyawan' : 'Tambah Karyawan';
  document.getElementById('emp-password-hint').textContent = emp ? '(kosongkan jika tidak diubah)' : '(wajib untuk karyawan baru)';
  document.getElementById('emp-form-name').value = emp ? emp.name : '';
  document.getElementById('emp-form-email').value = emp ? emp.email : '';
  document.getElementById('emp-form-nik').value = emp ? emp.nik || '' : '';
  document.getElementById('emp-form-password').value = '';
  document.getElementById('emp-form-role').value = emp ? emp.role : 'employee';
  if (emp && emp.position_id) document.getElementById('emp-form-position').value = emp.position_id;
  if (emp && emp.location_id) document.getElementById('emp-form-location').value = emp.location_id;
  document.getElementById('employee-form-card').classList.remove('hidden');
}

document.getElementById('form-employee').onsubmit = async (e) => {
  e.preventDefault();
  hideFieldError('emp-form-password-rule-error');
  try {
    const password = document.getElementById('emp-form-password').value;
    if (password && !isPasswordValid(password)) {
      return showFieldError('emp-form-password-rule-error');
    }
    const fd = new FormData();
    fd.append('name', document.getElementById('emp-form-name').value);
    fd.append('email', document.getElementById('emp-form-email').value);
    fd.append('nik', document.getElementById('emp-form-nik').value);
    fd.append('role', document.getElementById('emp-form-role').value);
    fd.append('positionId', document.getElementById('emp-form-position').value);
    fd.append('locationId', document.getElementById('emp-form-location').value);
    if (password) fd.append('password', password);
    const photoFile = document.getElementById('emp-form-photo').files[0];
    if (photoFile) fd.append('photo', photoFile);

    if (state.editingEmployeeId) {
      await api(`/admin/employees/${state.editingEmployeeId}`, { method: 'PUT', body: fd });
      toast('Karyawan diperbarui');
    } else {
      if (!password) return toast('Password wajib diisi untuk karyawan baru', true);
      await api('/admin/employees', { method: 'POST', body: fd });
      toast('Karyawan ditambahkan');
    }
    document.getElementById('employee-form-card').classList.add('hidden');
    e.target.reset();
    loadEmployees();
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------------- ADMIN: LOCATIONS ----------------
async function loadLocations() {
  const { rows } = await api('/admin/locations');
  state.locations = rows;
  const tbody = document.querySelector('#table-locations tbody');
  tbody.innerHTML = rows
    .map(
      (l) => `<tr>
        <td>${l.name}</td><td>${l.lat}</td><td>${l.lng}</td><td>${l.radius_meters}</td>
        <td><button class="btn-secondary btn-delete-loc" data-id="${l.id}">Hapus</button></td>
      </tr>`
    )
    .join('');
  document.querySelectorAll('.btn-delete-loc').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/admin/locations/${btn.dataset.id}`, { method: 'DELETE' });
      loadLocations();
    };
  });
}
document.getElementById('form-location').onsubmit = async (e) => {
  e.preventDefault();
  await api('/admin/locations', {
    method: 'POST',
    body: JSON.stringify({
      name: document.getElementById('loc-name').value,
      lat: document.getElementById('loc-lat').value,
      lng: document.getElementById('loc-lng').value,
      radiusMeters: document.getElementById('loc-radius').value,
    }),
  });
  e.target.reset();
  document.getElementById('loc-radius').value = 150;
  loadLocations();
};

// ---------------- ADMIN: POSITIONS ----------------
async function loadPositions() {
  const { rows } = await api('/admin/positions');
  state.positions = rows;
  const tbody = document.querySelector('#table-positions tbody');
  tbody.innerHTML = rows
    .map(
      (p) => `<tr><td>${p.name}</td><td><button class="btn-secondary btn-delete-pos" data-id="${p.id}">Hapus</button></td></tr>`
    )
    .join('');
  document.querySelectorAll('.btn-delete-pos').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/admin/positions/${btn.dataset.id}`, { method: 'DELETE' });
      loadPositions();
    };
  });
}
document.getElementById('form-position').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/admin/positions', { method: 'POST', body: JSON.stringify({ name: document.getElementById('pos-name').value }) });
    e.target.reset();
    loadPositions();
  } catch (err) {
    toast(err.message, true);
  }
};

// ---------------- ADMIN: ACTIVITY LOG ----------------
const ACTIVITY_LABELS = {
  reset_password: { label: 'Lupa Password (Reset Mandiri)', badge: 'warn' },
  change_password: { label: 'Ubah Password', badge: 'ok' },
  verify_attendance: { label: 'Verifikasi Absen', badge: 'ok' },
  reject_attendance: { label: 'Tolak Absen', badge: 'warn' },
};

async function loadActivity() {
  const { rows } = await api('/admin/activity-log');
  const tbody = document.querySelector('#table-activity tbody');
  tbody.innerHTML = rows
    .map((r) => {
      const meta = ACTIVITY_LABELS[r.action];
      const actionHtml = meta
        ? `<span class="badge ${meta.badge}">${meta.label}</span>`
        : r.action;
      return `<tr><td>${r.created_at}</td><td>${r.name || '-'}</td><td>${actionHtml}</td><td>${r.detail || '-'}</td></tr>`;
    })
    .join('');
}

// ---------------- ADMIN: PROFIL (HCM) ----------------
function loadAdminProfile() {
  const emp = state.employee;
  document.getElementById('adm-profile-name').value = emp.name || '';
  document.getElementById('adm-profile-email').value = emp.email || '';
  document.getElementById('adm-profile-nik').value = emp.nik || '';
  if (emp.positionId) document.getElementById('adm-profile-position').value = emp.positionId;
  if (emp.locationId) document.getElementById('adm-profile-location').value = emp.locationId;
  document.getElementById('adm-profile-join-date').value = formatDateID(emp.joinDate);
}

document.getElementById('form-admin-profile').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const name = document.getElementById('adm-profile-name').value;
    const email = document.getElementById('adm-profile-email').value;
    const nik = document.getElementById('adm-profile-nik').value;
    const positionId = document.getElementById('adm-profile-position').value;
    const locationId = document.getElementById('adm-profile-location').value;
    await api(`/admin/employees/${state.employee.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, email, nik, positionId, locationId }),
    });
    state.employee.name = name;
    state.employee.email = email;
    state.employee.nik = nik;
    state.employee.positionId = positionId;
    state.employee.locationId = locationId;
    document.getElementById('admin-name').textContent = name;
    toast('Data diri berhasil diperbarui');
  } catch (err) {
    toast(err.message, true);
  }
};

document.getElementById('form-adm-change-password').onsubmit = async (e) => {
  e.preventDefault();
  hideFieldError('adm-cp-error');
  try {
    const currentPassword = document.getElementById('adm-cp-current').value;
    const newPassword = document.getElementById('adm-cp-new').value;
    if (!isPasswordValid(newPassword)) {
      return showFieldError('adm-cp-new-rule-error');
    }
    await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    toast('Password berhasil diubah');
    e.target.reset();
  } catch (err) {
    showFieldError('adm-cp-error', err.message);
  }
};
