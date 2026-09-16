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

/**
 * Evaluate indications of fake GPS for a check-in.
 * @param {object} params
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {number|null} params.accuracy - meters, from browser Geolocation API
 * @param {Array<object>} params.locations - all registered office locations { name, lat, lng, radius_meters }
 * @param {object|null} params.lastAttendance - most recent previous attendance row { lat, lng, timestamp }
 * @returns {{ flagged: boolean, reasons: string[], distanceFromLocation: number|null }}
 */
function evaluateFakeGps({ lat, lng, accuracy, locations, lastAttendance }) {
  const reasons = [];

  if (accuracy === null || accuracy === undefined) {
    reasons.push('Data akurasi GPS tidak tersedia (indikasi lokasi palsu/mock location)');
  } else if (accuracy > ACCURACY_THRESHOLD_M) {
    reasons.push(`Akurasi GPS rendah (±${Math.round(accuracy)}m), melebihi ambang ${ACCURACY_THRESHOLD_M}m`);
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
    const elapsedHours = (Date.now() - new Date(lastAttendance.timestamp + 'Z').getTime()) / 3600000;
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

module.exports = { evaluateFakeGps, findNearestLocation };
