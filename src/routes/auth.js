const { verifyGoogleIdToken } = require('../googleAuth');
const db = require('../db');
const teamDb = require('../teamDb');
const session = require('../session');
const { readJsonBody } = require('../bodyParser');

function sendJson(res, statusCode, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

/**
 * POST /api/auth/google
 *
 * Menerima { credential } dari tombol Google Identity Services di browser
 * (ux_mode "popup"), memverifikasi credential (JWT ID token) itu SENDIRI
 * pakai googleAuth.js (tanpa library eksternal), lalu:
 *  - Kalau valid: upsert user berdasarkan `sub` token (googleId - primary
 *    key permanen, BUKAN email), buat session cookie yang ditandatangani,
 *    dan kembalikan 200 JSON { ok: true, redirectTo: '/app' } + header
 *    Set-Cookie.
 *  - Kalau tidak valid: 401 JSON { ok: false, error }.
 *
 * Catatan penyesuaian dari spek: alur di spek menyebut "server redirect
 * (302) ke /app". Di sini step 2 (client) memakai fetch() untuk POST
 * credential ke endpoint ini - fetch() akan MENGIKUTI redirect 302 secara
 * otomatis di belakang layar, bukan memindahkan browser ke halaman baru.
 * Supaya perilaku benar-benar berpindah halaman (dan supaya frontend bisa
 * mengecek res.ok dulu sebelum pindah), server ini merespons 200 dengan
 * field redirectTo, dan client yang melakukan window.location.href =
 * data.redirectTo. Logika keamanannya sama persis: verifikasi token di
 * server -> set cookie sesi bertanda tangan -> baru pindah ke /app.
 */
async function handleGoogleAuth(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    console.error('[auth] Gagal baca body /api/auth/google:', err.message);
    sendJson(res, 400, { ok: false, error: 'Body request tidak valid.' });
    return;
  }

  const credential = body && body.credential;
  if (!credential) {
    sendJson(res, 400, { ok: false, error: 'Field "credential" wajib diisi.' });
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error('[auth] GOOGLE_CLIENT_ID belum diatur di environment variable.');
    sendJson(res, 500, {
      ok: false,
      error: 'Konfigurasi server belum lengkap (GOOGLE_CLIENT_ID belum diatur).',
    });
    return;
  }

  let payload;
  try {
    payload = await verifyGoogleIdToken(credential, { clientId });
  } catch (err) {
    console.error('[auth] Verifikasi Google ID token gagal:', err.message);
    sendJson(res, 401, { ok: false, error: 'Login Google gagal diverifikasi: ' + err.message });
    return;
  }

  let cookieValue;
  try {
    cookieValue = session.createSessionCookieValue({ googleId: payload.sub });
  } catch (err) {
    console.error('[auth] Gagal membuat session cookie (cek SESSION_SECRET):', err.message);
    sendJson(res, 500, { ok: false, error: 'Konfigurasi server belum lengkap (SESSION_SECRET).' });
    return;
  }

  let user = db.upsertUserFromGoogle({
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  });

  // Kalau email ini terdaftar sebagai anggota tim (aktif) milik owner lain,
  // gabungkan ke workspace owner tersebut sekarang juga - lihat
  // teamDb.syncMembershipOnLogin() untuk aturan lengkapnya (termasuk
  // jaring-pengaman pelepasan kalau keanggotaannya sudah tidak aktif).
  user = teamDb.syncMembershipOnLogin(user);

  console.log(
    `[auth] Login sukses untuk googleId=${user.googleId} email=${user.email} role=${user.role || 'owner'}`
  );

  sendJson(
    res,
    200,
    { ok: true, redirectTo: '/app' },
    { 'Set-Cookie': session.buildSetCookieHeader(cookieValue) }
  );
}

function handleLogout(req, res) {
  res.writeHead(302, {
    Location: '/',
    'Set-Cookie': session.buildLogoutCookieHeader(),
  });
  res.end();
}

module.exports = { handleGoogleAuth, handleLogout };
