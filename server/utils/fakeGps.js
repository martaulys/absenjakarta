const { distanceMeters } = require('./geo');

const ACCURACY_THRESHOLD_M = 100; // GPS accuracy worse than this is suspicious
const MIN_PLAUSIBLE_SPEED_KMH = 300; // faster than this between two check-ins implies spoofing

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

const IP_GPS_MISMATCH_THRESHOLD_KM = 100; // IP-derived location vs GPS further apart than this is suspicious

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
 * Evaluate indications of fake GPS for a check-in.
 * @param {object} params
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {number|null} params.accuracy - meters, from browser Geolocation API
 * @param {Array<object>} params.locations - all registered office locations { name, lat, lng, radius_meters }
 * @param {object|null} params.lastAttendance - most recent previous attendance row { lat, lng, timestamp }
 * @param {boolean} [params.geoApiSuspicious] - client reported the Geolocation API looks tampered with
 * @param {{lat:number,lng:number,city?:string,country?:string}|null} [params.ipLocation] - result of lookupIpLocation()
 * @returns {{ flagged: boolean, reasons: string[], distanceFromLocation: number|null }}
 */
function evaluateFakeGps({ lat, lng, accuracy, locations, lastAttendance, geoApiSuspicious, ipLocation }) {
  const reasons = [];

  if (accuracy === null || accuracy === undefined) {
    reasons.push('Data akurasi GPS tidak tersedia (indikasi lokasi palsu/mock location)');
  } else if (accuracy > ACCURACY_THRESHOLD_M) {
    reasons.push(`Akurasi GPS rendah (±${Math.round(accuracy)}m), melebihi ambang ${ACCURACY_THRESHOLD_M}m`);
  }

  if (geoApiSuspicious) {
    reasons.push('Browser mendeteksi API geolocation kemungkinan telah dimodifikasi (indikasi aplikasi mock location)');
  }

  if (ipLocation) {
    const ipDistanceKm = distanceMeters(lat, lng, ipLocation.lat, ipLocation.lng) / 1000;
    if (ipDistanceKm > IP_GPS_MISMATCH_THRESHOLD_KM) {
      reasons.push(
        `Lokasi dari alamat IP (≈${ipLocation.city || ipLocation.country || 'tidak diketahui'}) berjarak ≈${Math.round(
          ipDistanceKm
        )}km dari koordinat GPS, kemungkinan GPS dipalsukan`
      );
    }
  }

  let distanceFromLocation = null;
  const nearest = findNearestLocation(lat, lng, locations);
  if (nearest) {
    distanceFromLocation = nearest.distance;
    if (distanceFromLocation > nearest.location.radius_meters) {
      reasons.push(
        `Lokasi absen berada ${Math.round(distanceFromLocation)}m dari lokasi terdaftar terdekat (${nearest.location.name}), melebihi radius ${nearest.location.radius_meters}m`
      );
    }
  }

  if (lastAttendance && lastAttendance.lat != null && lastAttendance.lng != null) {
    const jumpDistance = distanceMeters(lat, lng, lastAttendance.lat, lastAttendance.lng);
    const elapsedHours = (Date.now() - new Date(lastAttendance.timestamp + '+07:00').getTime()) / 3600000;
    if (elapsedHours > 0) {
      const impliedSpeedKmh = jumpDistance / 1000 / elapsedHours;
      if (impliedSpeedKmh > MIN_PLAUSIBLE_SPEED_KMH) {
        reasons.push(
          `Lompatan lokasi tidak wajar dari absen sebelumnya (≈${Math.round(jumpDistance / 1000)}km dalam ${elapsedHours.toFixed(
            1
          )} jam)`
        );
      }
    }
  }

  return { flagged: reasons.length > 0, reasons, distanceFromLocation };
}

module.exports = { evaluateFakeGps, findNearestLocation, lookupIpLocation };
