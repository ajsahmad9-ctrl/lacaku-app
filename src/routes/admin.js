const { readJsonBody } = require('../bodyParser');
const { unlockUserByEmail } = require('../unlock');

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * POST /api/admin/unlock
 *
 * Jaring pengaman manual untuk kasus webhook Scalev tidak pernah sampai
 * (mis. salah konfigurasi URL webhook, gangguan jaringan sesaat, dsb).
 * Diproteksi dengan secret TERPISAH dari SESSION_SECRET (ADMIN_UNLOCK_SECRET)
 * supaya kompromi salah satu secret tidak otomatis membuka yang lain.
 *
 * Sengaja memakai fungsi terpusat yang SAMA (unlockUserByEmail) dengan yang
 * dipakai webhook - supaya tidak ada dua jalur kode berbeda yang bisa
 * mengubah field `unlocked`.
 */
async function handleAdminUnlock(req, res) {
  const configuredSecret = process.env.ADMIN_UNLOCK_SECRET;
  if (!configuredSecret) {
    console.error('[admin] ADMIN_UNLOCK_SECRET belum diatur di environment variable.');
    sendJson(res, 500, { ok: false, error: 'ADMIN_UNLOCK_SECRET belum dikonfigurasi di server.' });
    return;
  }

  const providedSecret = req.headers['x-admin-secret'];
  if (!providedSecret || providedSecret !== configuredSecret) {
    console.warn('[admin] Percobaan akses /api/admin/unlock dengan secret salah/kosong.');
    sendJson(res, 403, { ok: false, error: 'Secret admin salah atau tidak ada.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: 'Body request tidak valid: ' + err.message });
    return;
  }

  const email = body && body.email;
  if (!email) {
    sendJson(res, 400, { ok: false, error: 'Field "email" wajib diisi.' });
    return;
  }

  try {
    const user = unlockUserByEmail(email);
    console.log(`[admin] Unlock manual berhasil untuk email=${email} (userId=${user.id}).`);
    sendJson(res, 200, { ok: true, email: user.email, unlocked: user.unlocked, unlockedAt: user.unlockedAt });
  } catch (err) {
    console.error(`[admin] Unlock manual GAGAL untuk email=${email}:`, err.message);
    sendJson(res, 404, { ok: false, error: err.message });
  }
}

module.exports = { handleAdminUnlock };
