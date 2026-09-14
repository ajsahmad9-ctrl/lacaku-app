const session = require('../session');
const db = require('../db');
const { isEffectivelyUnlocked } = require('../ownerAccess');

function sendHtmlError(res, statusCode, title, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: sans-serif; max-width: 640px; margin: 4rem auto; line-height: 1.6;">
  <h1>${title}</h1>
  <p>${message}</p>
  <p><a href="/">Kembali ke halaman utama</a></p>
</body></html>`);
}

/**
 * GET /checkout
 *
 * - Kalau belum login -> redirect ke halaman login ("/").
 * - Kalau user sudah `unlocked` -> langsung redirect ke "/app" (tidak ada
 *   alasan checkout ulang, dan mencegah pembelian ganda).
 * - Kalau SCALEV_CHECKOUT_URL belum diatur -> tampilkan error yang JELAS
 *   (bukan gagal diam-diam / halaman putih), sekaligus catat di log server.
 * - Kalau semua aman -> redirect top-level (302, BUKAN iframe) ke halaman
 *   checkout Scalev. Scalev secara sengaja memblokir dirinya sendiri untuk
 *   ditampilkan di dalam iframe (lewat X-Frame-Options/CSP), jadi harus
 *   benar-benar berpindah halaman, bukan ditempel di dalam Lacaku/app kita.
 */
function handleCheckout(req, res) {
  const sessionData = session.getSessionFromRequest(req);
  if (!sessionData || !sessionData.googleId) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  const user = db.findUserByGoogleId(sessionData.googleId);
  if (!user) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  if (isEffectivelyUnlocked(user)) {
    res.writeHead(302, { Location: '/app' });
    res.end();
    return;
  }

  const checkoutUrl = process.env.SCALEV_CHECKOUT_URL;
  if (!checkoutUrl) {
    console.error('[checkout] SCALEV_CHECKOUT_URL belum diatur di environment variable.');
    sendHtmlError(
      res,
      500,
      'Checkout belum siap',
      'Konfigurasi server belum lengkap: SCALEV_CHECKOUT_URL belum diatur. ' +
        'Hubungi admin aplikasi ini untuk melengkapi konfigurasi.'
    );
    return;
  }

  console.log(`[checkout] Redirect user email=${user.email} ke checkout Scalev.`);
  res.writeHead(302, { Location: checkoutUrl });
  res.end();
}

module.exports = { handleCheckout };
