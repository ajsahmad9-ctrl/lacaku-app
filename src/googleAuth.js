const crypto = require('crypto');
const https = require('https');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam - sesuai spesifikasi

let certsCache = null; // { fetchedAt, keys: [...] }

function httpGetJson(urlStr) {
  return new Promise((resolve, reject) => {
    https
      .get(urlStr, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GET ${urlStr} gagal, status ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function getGoogleCerts() {
  const now = Date.now();
  if (certsCache && now - certsCache.fetchedAt < CACHE_TTL_MS) {
    return certsCache.keys;
  }
  const json = await httpGetJson(GOOGLE_CERTS_URL);
  certsCache = { fetchedAt: now, keys: json.keys || [] };
  return certsCache.keys;
}

function decodeJwtParts(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Format ID token tidak valid (bukan 3 bagian).');
  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');
  return { header, payload, signingInput, signature };
}

function verifyRs256Signature(signingInput, signature, jwk) {
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(publicKey, signature);
}

/**
 * Verifikasi Google ID token SECARA MANDIRI - hanya modul bawaan Node
 * (crypto, https), TANPA library eksternal apa pun (bukan
 * google-auth-library, bukan jsonwebtoken). Melempar Error dengan pesan
 * jelas kalau token tidak valid; mengembalikan payload token kalau valid.
 *
 * Ini yang membuktikan credential yang dikirim browser benar-benar
 * diterbitkan Google DAN memang ditujukan untuk aplikasi kita (klaim
 * `aud`) - jangan pernah percaya begitu saja pada apa pun yang dikirim
 * client tanpa verifikasi signature + klaim ini.
 */
async function verifyGoogleIdToken(idToken, { clientId }) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('ID token kosong/tidak valid.');
  }
  if (!clientId) {
    throw new Error('clientId (GOOGLE_CLIENT_ID) wajib diberikan untuk verifikasi.');
  }

  const { header, payload, signingInput, signature } = decodeJwtParts(idToken);

  const keys = await getGoogleCerts();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(
      `Public key Google dengan kid="${header.kid}" tidak ditemukan (kemungkinan baru rotasi kunci - coba lagi).`
    );
  }

  const signatureValid = verifyRs256Signature(signingInput, signature, jwk);
  if (!signatureValid) {
    throw new Error('Signature ID token tidak valid - token mungkin dipalsukan atau rusak.');
  }

  if (payload.aud !== clientId) {
    throw new Error(
      `Klaim "aud" pada token (${payload.aud}) tidak cocok dengan GOOGLE_CLIENT_ID aplikasi ini.`
    );
  }
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error(`Klaim "iss" pada token (${payload.iss}) bukan dari Google.`);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSeconds) {
    throw new Error('ID token sudah kedaluwarsa.');
  }

  return payload; // { sub, email, name, picture, aud, iss, exp, ... }
}

// Diekspos supaya bisa di-reset di test (menghindari cache lintas-test).
function _resetCertsCacheForTest() {
  certsCache = null;
}

module.exports = { verifyGoogleIdToken, _resetCertsCacheForTest };
