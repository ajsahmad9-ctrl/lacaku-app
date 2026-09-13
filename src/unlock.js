const db = require('./db');

/**
 * SATU-SATUNYA fungsi tingkat-aplikasi yang boleh dipanggil untuk membuka
 * akses (unlock) seorang user berdasarkan email. Dipanggil HANYA dari dua
 * tempat:
 *   1. Webhook Scalev (routes/webhook.js), setelah status order
 *      re-diverifikasi langsung ke API Scalev (bukan dari body webhook).
 *   2. Endpoint admin manual (routes/admin.js), untuk jaga-jaga kalau
 *      webhook tidak pernah sampai.
 *
 * Di dalamnya cuma mendelegasikan ke db.setUserUnlocked() - satu-satunya
 * fungsi level-database yang boleh menyentuh field `unlocked`. Dua lapis
 * "satu pintu" ini sengaja dibuat supaya tidak ada jalan lain di kode yang
 * bisa diam-diam mengubah status unlock seorang user.
 */
function unlockUserByEmail(email) {
  const user = db.findUserByEmail(email);
  if (!user) {
    throw new Error(
      `Tidak ada user dengan email "${email}" yang cocok. Pastikan email yang dipakai saat ` +
        'checkout di Scalev sama persis dengan email akun Google yang dipakai login.'
    );
  }
  const updated = db.setUserUnlocked(user.id, true);
  return updated;
}

module.exports = { unlockUserByEmail };
