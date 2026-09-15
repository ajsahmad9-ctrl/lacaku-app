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
// PENTING: ini HARUS link publish artifact yang berdiri sendiri (bentuk
// "claude.ai/artifact/<kode>"), BUKAN link "claude.ai/code/artifact/<uuid>"
// (tampilan artifact yang dibungkus di dalam chrome chat/sesi Claude Code -
// ada bar "Share"/ikon chat di atasnya). Yang kedua ternyata TIDAK meneruskan
// parameter "?workspace=" ke halaman Lacaku sesungguhnya (kemungkinan
// artifact-nya dirender di dalam iframe terpisah di sana), jadi Lacaku selalu
// melihat "tidak ada workspace" walau URL luarnya sudah benar - itulah
// penyebab "Akses Tidak Valid" yang sempat muncul terus-menerus.
const DEFAULT_LACAKU_APP_URL = 'https://claude.ai/artifact/FkAD2GnybgQ747FVbnrbm2';

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

  // no-store: halaman ini dirender ulang tiap request (workspaceId/URL
  // Lacaku disisipkan server-side), dan aplikasi ini masih sering
  // di-update - tanpa header ini browser bisa menyimpan versi lama dan
  // fitur baru terasa "belum muncul" walau server sudah benar.
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
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
    const baseLacakuAppUrl = process.env.LACAKU_APP_URL || DEFAULT_LACAKU_APP_URL;
    // Setiap user/bisnis punya workspaceId sendiri (dibuat sekali, tersimpan
    // di users.json) - dikirim ke Lacaku lewat "?workspace=" supaya data
    // resi/retur/tim satu bisnis tidak tercampur dengan bisnis lain, karena
    // semua pelanggan memakai artifact Lacaku yang sama. Lihat
    // resolveWorkspaceId()/wrapDbForWorkspace() di kode Lacaku.
    const workspaceId = db.getOrCreateWorkspaceId(user.id);
    const separator = baseLacakuAppUrl.includes('?') ? '&' : '?';
    const lacakuAppUrl = workspaceId
      ? `${baseLacakuAppUrl}${separator}workspace=${encodeURIComponent(workspaceId)}`
      : baseLacakuAppUrl;
    html = html.split('%%LACAKU_APP_URL%%').join(lacakuAppUrl);

    // no-store - lihat catatan yang sama di serveLoginPage() di atas.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(html);
  });
}

module.exports = { serveLoginPage, serveAppPage, PUBLIC_DIR };
