function requireAuth(req, res, next) {
  if (!req.session.employeeId) {
    return res.status(401).json({ error: 'Belum login' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.employeeId || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Akses ditolak, khusus admin' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
