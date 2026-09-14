const fs = require('fs');
const path = require('path');
const session = require('../session');
const db = require('../db');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

// URL aplikasi Lacaku yang sesungguhnya (saat ini masih berupa Claude
// Artifact terpisah - lihat catatan di README). Aplikasi payment/login ini
// hanyalah "pintu gerbang": setelah unlocked, user diarahkan ke sini untuk
// benar-benar memakai Lacaku. Bisa dioverride lewat env var LACAKU_APP_URL
// kalau Lacaku dipindah ke domain sendiri di kemudian hari.
const DEFAULT_LACAKU_APP_URL = 'https://claude.ai/code/artifact/776698f8-05af-47fa-b16d-69f3395a8b79';

/**
 * GET /
 *
 * Halaman login. data-client_id tombol Google TIDAK BISA jadi file statis
 * apa adanya karena nilainya (GOOGLE_CLIENT_ID) datang dari environment
 * variable server, jadi di sini kita baca file HTML lalu ganti placeholder
 * %%GOOGLE_CLIENT_ID%% dengan nilai sebenarnya sebelum dikirim ke browser.
 *
 * Kalau user sudah login, langsung arahkan ke /app supaya tidak
 * bolak-balik ke halaman login.
 */
function serveLoginPage(req, res) {
  const sessionData = session.getSessionFromRequest(req);
  if (sessionData && sessionData.googleId && db.findUserByGoogleId(sessionData.googleId)) {
    res.writeHead(302, { Location: '/app' });
    res.end();
    return;
  }

  const filePath = path.join(PUBLIC_DIR, 'index.html');
  let html;
  try {
    html = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error('[pages] Gagal baca public/index.html:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Terjadi kesalahan pada server.');
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!clientId) {
    console.warn('[pages] GOOGLE_CLIENT_ID belum diatur - tombol login Google tidak akan berfungsi.');
  }
  html = html.split('%%GOOGLE_CLIENT_ID%%').join(clientId);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

/**
 * GET /app
 *
 * Halaman dashboard utama. Kalau belum login, redirect ke "/" (bukan
 * ditampilkan error) supaya alurnya mulus buat user biasa.
 */
function serveAppPage(req, res) {
  const sessionData = session.getSessionFromRequest(req);
  const user = sessionData && sessionData.googleId ? db.findUserByGoogleId(sessionData.googleId) : null;
  if (!user) {
    res.writeHead(302, { Location: '/' });
    res.end();
    return;
  }

  const filePath = path.join(PUBLIC_DIR, 'app.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) {
      console.error('[pages] Gagal baca public/app.html:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Terjadi kesalahan pada server.');
      return;
    }
    const lacakuAppUrl = process.env.LACAKU_APP_URL || DEFAULT_LACAKU_APP_URL;
    html = html.split('%%LACAKU_APP_URL%%').join(lacakuAppUrl);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
}

module.exports = { serveLoginPage, serveAppPage, PUBLIC_DIR };
