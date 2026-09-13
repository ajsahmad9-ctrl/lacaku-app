const crypto = require('crypto');

const SESSION_COOKIE_NAME = 'session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 hari
const PLACEHOLDER_SECRET = 'ganti-dengan-string-acak-panjang-anda-sendiri';

function assertSessionSecretConfigured() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === PLACEHOLDER_SECRET) {
    throw new Error(
      'SESSION_SECRET belum diatur (atau masih nilai contoh di .env.example) di environment ' +
        'variable. Set SESSION_SECRET ke string acak yang panjang sebelum menjalankan server ini.'
    );
  }
  return secret;
}

function sign(payloadBase64) {
  const secret = assertSessionSecretConfigured();
  return crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');
}

function createSessionCookieValue(payloadObj) {
  const payloadBase64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const signature = sign(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function verifySessionCookieValue(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;
  const [payloadBase64, signature] = parts;

  let expectedSignature;
  try {
    expectedSignature = sign(payloadBase64);
  } catch (err) {
    console.error('[session] Tidak bisa memverifikasi cookie:', err.message);
    return null;
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSignature);
  // timingSafeEqual butuh panjang buffer sama - kalau beda, signature pasti
  // salah, tapi tetap dicek dulu supaya tidak melempar exception.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function buildSetCookieHeader(cookieValue, { maxAgeSeconds } = {}) {
  const attrs = [`${SESSION_COOKIE_NAME}=${cookieValue}`, 'HttpOnly', 'Path=/', 'SameSite=Lax'];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  attrs.push(`Max-Age=${maxAgeSeconds != null ? maxAgeSeconds : SESSION_MAX_AGE_SECONDS}`);
  return attrs.join('; ');
}

function buildLogoutCookieHeader() {
  return buildSetCookieHeader('', { maxAgeSeconds: 0 });
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  });
  return out;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[SESSION_COOKIE_NAME];
  return verifySessionCookieValue(raw);
}

module.exports = {
  SESSION_COOKIE_NAME,
  createSessionCookieValue,
  verifySessionCookieValue,
  buildSetCookieHeader,
  buildLogoutCookieHeader,
  parseCookies,
  getSessionFromRequest,
};
