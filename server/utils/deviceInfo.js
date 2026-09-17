/** Turn a User-Agent string into a short human-readable device/browser label. */
function parseDeviceInfo(userAgent) {
  if (!userAgent) return 'Tidak diketahui';
  const ua = userAgent;

  let os = 'Tidak diketahui';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser lain';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/CriOS\//i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const deviceType = isMobile ? 'Mobile' : 'Desktop';

  return `${os} - ${browser} (${deviceType})`;
}

/** Best-effort extraction of the real client IP behind proxies (Railway, etc). */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || (req.socket && req.socket.remoteAddress) || null;
}

module.exports = { parseDeviceInfo, getClientIp };
