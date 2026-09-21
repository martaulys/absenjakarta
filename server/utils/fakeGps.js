const { distanceMeters } = require('./geo');

const ACCURACY_THRESHOLD_M = 100; // GPS accuracy worse than this is suspicious
const MIN_PLAUSIBLE_SPEED_KMH = 300; // faster than this between two check-ins implies spoofing
const IP_GPS_MISMATCH_THRESHOLD_KM = 100; // IP-derived location vs GPS further apart than this is suspicious
const EXACT_MATCH_EPSILON_DEG = 0.00003; // ~3m - treated as "identical" coordinates (GPS jitter, floating point noise)
const STATIC_SAMPLE_EPSILON_DEG = 0.000005; // ~0.5m - two same-checkin samples this close is unnaturally static
const REVIEW_SCORE_THRESHOLD = 25; // combined weak signals reaching this score also trigger review

/**
 * Find the registered office location nearest to a given coordinate.
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{id:number, name:string, lat:number, lng:number, radius_meters:number}>} locations
 * @returns {{ location: object, distance: number } | null}
 */
function findNearestLocation(lat, lng, locations) {
  if (!locations || locations.length === 0) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const loc of locations) {
    const d = distanceMeters(lat, lng, loc.lat, loc.lng);
    if (d < nearestDistance) {
      nearestDistance = d;
      nearest = loc;
    }
  }
  return { location: nearest, distance: nearestDistance };
}

function isNearlyEqual(a, b, epsilon) {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Look up an approximate location for a public IP address (best-effort, non-blocking).
 * Returns null for private/local IPs or if the lookup fails/times out.
 */
async function lookupIpLocation(ip) {
  if (!ip) return null;
  const cleanIp = ip.replace('::ffff:', '');
  if (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    /^10\./.test(cleanIp) ||
    /^192\.168\./.test(cleanIp) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(cleanIp)
  ) {
    return null; // private/local network, IP geolocation not meaningful
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    // ip-api.com free tier: HTTP only, no key, ~45 req/min - fine for internal low-volume use.
    const res = await fetch(`http://ip-api.com/json/${cleanIp}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success' || typeof data.lat !== 'number' || typeof data.lon !== 'number') return null;
    return { lat: data.lat, lng: data.lon, city: data.city, country: data.country };
  } catch {
    return null; // network error/timeout - fail open, never block check-in on this
  }
}

/**
 * Evaluate indications of fake/mock GPS for a check-in using a multi-signal risk score.
 * Any single "severe" signal, or several weaker signals combined, flags the check-in for
 * admin review. Server-side only - the client cannot influence the verdict, only supply data.
 *
 * @param {object} p
 * @param {number} p.lat
 * @param {number} p.lng
 * @param {number|null} p.accuracy - meters, from browser Geolocation API
 * @param {Array<object>} p.locations - all registered office locations { name, lat, lng, radius_meters }
 * @param {object|null} p.lastAttendance - most recent previous attendance row for this employee { lat, lng, timestamp, accuracy }
 * @param {Array<object>} [p.recentOwnAttendance] - this employee's last N attendance rows, for repeat-coordinate checks
 * @param {boolean} [p.geoApiSuspicious] - client reported the Geolocation API looks tampered with
 * @param {{lat:number,lng:number,city?:string,country?:string}|null} [p.ipLocation] - result of lookupIpLocation()
 * @param {{lat:number,lng:number,elapsedMs:number}|null} [p.sample2] - a 2nd GPS reading taken a few seconds after the 1st
 * @param {{employeeName:string,minutesAgo:number}|null} [p.sharedDeviceOtherEmployee] - another employee checked in from the same IP+device shortly before
 * @returns {{ flagged: boolean, needsReview: boolean, reasons: string[], distanceFromLocation: number|null, riskScore: number }}
 */
function evaluateFakeGps({
  lat,
  lng,
  accuracy,
  locations,
  lastAttendance,
  recentOwnAttendance = [],
  geoApiSuspicious,
  ipLocation,
  sample2,
  sharedDeviceOtherEmployee,
}) {
  const reasons = [];
  let score = 0;
  let severe = false;

  // --- 1. GPS accuracy ---
  if (accuracy === null || accuracy === undefined) {
    reasons.push('Data akurasi GPS tidak tersedia (indikasi lokasi palsu/mock location)');
    score += 30;
    severe = true;
  } else if (accuracy > ACCURACY_THRESHOLD_M) {
    reasons.push(`Akurasi GPS rendah (±${Math.round(accuracy)}m), melebihi ambang ${ACCURACY_THRESHOLD_M}m`);
    score += 15;
  } else if (
    lastAttendance &&
    lastAttendance.accuracy != null &&
    accuracy === lastAttendance.accuracy &&
    Number.isInteger(accuracy) &&
    accuracy % 5 === 0
  ) {
    // Real device GPS accuracy fluctuates with satellite geometry; an identical round
    // number repeated across check-ins looks like a hardcoded/mocked value.
    reasons.push(`Nilai akurasi GPS (±${accuracy}m) identik & angka bulat berulang dari absen sebelumnya, indikasi nilai statis/palsu`);
    score += 20;
  }

  // --- 2. Client-reported Geolocation API tampering ---
  if (geoApiSuspicious) {
    reasons.push('Browser mendeteksi API geolocation kemungkinan telah dimodifikasi (indikasi aplikasi mock location)');
    score += 25;
  }

  // --- 3. IP geolocation cross-check ---
  if (ipLocation) {
    const ipDistanceKm = distanceMeters(lat, lng, ipLocation.lat, ipLocation.lng) / 1000;
    if (ipDistanceKm > IP_GPS_MISMATCH_THRESHOLD_KM) {
      reasons.push(
        `Lokasi dari alamat IP (≈${ipLocation.city || ipLocation.country || 'tidak diketahui'}) berjarak ≈${Math.round(
          ipDistanceKm
        )}km dari koordinat GPS, kemungkinan GPS dipalsukan`
      );
      score += 25;
    }
  }

  // --- 4. Distance to nearest registered office ---
  let distanceFromLocation = null;
  const nearest = findNearestLocation(lat, lng, locations);
  if (nearest) {
    distanceFromLocation = nearest.distance;
    if (distanceFromLocation > nearest.location.radius_meters) {
      reasons.push(
        `Lokasi absen berada ${Math.round(distanceFromLocation)}m dari lokasi terdaftar terdekat (${nearest.location.name}), melebihi radius ${nearest.location.radius_meters}m`
      );
      score += 25;
      severe = true;
    } else if (
      distanceFromLocation < 3 &&
      isNearlyEqual(lat, nearest.location.lat, EXACT_MATCH_EPSILON_DEG) &&
      isNearlyEqual(lng, nearest.location.lng, EXACT_MATCH_EPSILON_DEG)
    ) {
      // Coordinates essentially bit-identical to the office's stored point - real handheld
      // GPS almost never lands exactly on a manually-entered reference coordinate.
      reasons.push(
        `Koordinat GPS nyaris identik persis dengan titik kantor terdaftar (${nearest.location.name}), tidak wajar untuk GPS perangkat nyata`
      );
      score += 15;
    }
  }

  // --- 5. Latitude/Longitude jump & speed vs the employee's own last check-in ---
  if (lastAttendance && lastAttendance.lat != null && lastAttendance.lng != null) {
    const jumpDistance = distanceMeters(lat, lng, lastAttendance.lat, lastAttendance.lng);
    const elapsedHours = (Date.now() - new Date(lastAttendance.timestamp + '+07:00').getTime()) / 3600000;
    if (elapsedHours > 0) {
      const impliedSpeedKmh = jumpDistance / 1000 / elapsedHours;
      if (impliedSpeedKmh > MIN_PLAUSIBLE_SPEED_KMH) {
        reasons.push(
          `Kecepatan perpindahan tidak wajar dari absen sebelumnya (≈${Math.round(jumpDistance / 1000)}km dalam ${elapsedHours.toFixed(
            1
          )} jam, ≈${Math.round(impliedSpeedKmh)}km/jam)`
        );
        score += 30;
        severe = true;
      }
    }
  }

  // --- 6. Exact-coordinate repeat vs this employee's own recent history ---
  const repeatedCoord = recentOwnAttendance.find(
    (r) =>
      r.lat != null &&
      r.lng != null &&
      isNearlyEqual(lat, r.lat, EXACT_MATCH_EPSILON_DEG) &&
      isNearlyEqual(lng, r.lng, EXACT_MATCH_EPSILON_DEG)
  );
  if (repeatedCoord) {
    reasons.push(
      `Koordinat GPS identik persis dengan absen pada ${repeatedCoord.timestamp}, GPS asli hampir selalu punya variasi kecil (jitter) antar pembacaan`
    );
    score += 20;
  }

  // --- 7. Second GPS sample taken a few seconds later during the same check-in ---
  if (sample2 && typeof sample2.lat === 'number' && typeof sample2.lng === 'number') {
    const driftMeters = distanceMeters(lat, lng, sample2.lat, sample2.lng);
    const elapsedSeconds = (sample2.elapsedMs || 0) / 1000;
    if (isNearlyEqual(lat, sample2.lat, STATIC_SAMPLE_EPSILON_DEG) && isNearlyEqual(lng, sample2.lng, STATIC_SAMPLE_EPSILON_DEG)) {
      reasons.push(
        `Dua pembacaan GPS berjarak ${elapsedSeconds.toFixed(1)} detik menghasilkan koordinat statis tanpa variasi alami, indikasi lokasi disuntik/mock`
      );
      score += 20;
    } else if (elapsedSeconds > 0) {
      const impliedSpeedKmh = driftMeters / 1000 / (elapsedSeconds / 3600);
      if (impliedSpeedKmh > MIN_PLAUSIBLE_SPEED_KMH) {
        reasons.push(
          `Pergerakan tidak masuk akal antar 2 pembacaan GPS dalam ${elapsedSeconds.toFixed(1)} detik (≈${Math.round(
            driftMeters
          )}m), indikasi lokasi meloncat/dipalsukan`
        );
        score += 25;
        severe = true;
      }
    }
  }

  // --- 8. Same IP + device used by a different employee shortly before (buddy punching) ---
  if (sharedDeviceOtherEmployee) {
    reasons.push(
      `Perangkat/alamat IP yang sama dipakai untuk absen ${sharedDeviceOtherEmployee.employeeName} ${Math.round(
        sharedDeviceOtherEmployee.minutesAgo
      )} menit lalu, indikasi absen titip/berbagi perangkat`
    );
    score += 35;
    severe = true;
  }

  const flagged = severe || score >= REVIEW_SCORE_THRESHOLD;
  return { flagged, needsReview: flagged, reasons, distanceFromLocation, riskScore: score };
}

module.exports = { evaluateFakeGps, findNearestLocation, lookupIpLocation };
