const session = require('../session');
const db = require('../db');

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * GET /api/me
 *
 * Dipakai frontend untuk (a) mengecek apakah user sedang login, dan (b)
 * di-poll berkala (tiap beberapa detik) di halaman /app supaya status
 * `unlocked` ter-update otomatis begitu webhook Scalev diproses di
 * belakang layar, TANPA user perlu refresh manual.
 */
function handleMe(req, res) {
  const sessionData = session.getSessionFromRequest(req);
  if (!sessionData || !sessionData.googleId) {
    sendJson(res, 401, { ok: false, error: 'Belum login.' });
    return;
  }

  const user = db.findUserByGoogleId(sessionData.googleId);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'User tidak ditemukan.' });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    email: user.email,
    name: user.name,
    picture: user.picture,
    unlocked: !!user.unlocked,
    unlockedAt: user.unlockedAt || null,
  });
}

module.exports = { handleMe };
