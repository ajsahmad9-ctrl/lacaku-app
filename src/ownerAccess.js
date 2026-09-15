const db = require('./db');

/**
 * Daftar email "pemilik/evaluator" yang SELALU dianggap unlocked, terlepas
 * dari status pembayaran Scalev yang sebenarnya. Ini KHUSUS untuk keperluan
 * evaluasi/testing pemilik aplikasi sendiri, supaya tetap bisa mengakses dan
 * menguji fitur-fitur baru kapan saja tanpa harus bayar/checkout ulang -
 * termasuk fitur-fitur yang baru ditambahkan di kemudian hari.
 *
 * PENTING soal keamanan - ini BUKAN jalur baru yang bisa mengubah field
 * `unlocked` di database. Lihat db.js/unlock.js: setUserUnlocked() tetap
 * SATU-SATUNYA fungsi yang boleh menyentuh field itu, dan tetap hanya
 * dipanggil dari webhook Scalev (setelah re-verifikasi ke API Scalev) atau
 * endpoint admin unlock manual. Modul ini SAMA SEKALI TIDAK menulis apa pun
 * ke database.
 *
 * Modul ini hanya dipakai saat MEMBACA status akses (GET /api/me, GET
 * /checkout) - kalau email user yang sedang login ada di daftar OWNER_EMAILS,
 * status yang dikirim ke frontend "dianggap" unlocked meskipun field
 * `unlocked` yang sebenarnya di database mungkin tetap false. Ini dicek
 * ulang dari environment variable di setiap request (bukan disimpan sebagai
 * flag statis di database), jadi otomatis tetap berlaku setelah deploy baru
 * atau penambahan fitur baru - tidak pernah "kedaluwarsa" dan tidak perlu
 * di-unlock ulang manual. Status pembayaran/akses user lain sama sekali
 * tidak terpengaruh oleh modul ini.
 *
 * Diisi lewat env var OWNER_EMAILS, dipisah koma, tidak case-sensitive.
 * Contoh: OWNER_EMAILS=ajsahmad9@gmail.com,owner2@example.com
 */
function getOwnerEmails() {
  const raw = process.env.OWNER_EMAILS || '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isOwnerEmail(email) {
  if (!email) return false;
  const owners = getOwnerEmails();
  if (owners.length === 0) return false;
  return owners.includes(String(email).trim().toLowerCase());
}

/**
 * Status akses "efektif" yang dipakai untuk menentukan apakah seorang user
 * boleh memakai aplikasi:
 *  - true kalau emailnya ada di daftar OWNER_EMAILS (akses evaluasi pemilik
 *    aplikasi), ATAU
 *  - untuk anggota tim (role 'member', lihat teamDb.js/db.js): mengikuti
 *    status `unlocked` OWNER workspace-nya, BUKAN field `unlocked` miliknya
 *    sendiri (anggota tim tidak bayar sendiri-sendiri) - dicek ulang dari
 *    database di setiap request, jadi otomatis ikut berubah begitu owner-nya
 *    unlock/lock, tanpa anggota tim perlu logout/login ulang, ATAU
 *  - untuk owner biasa: field `unlocked` di database true (user betulan
 *    sudah bayar / di-unlock admin).
 */
function isEffectivelyUnlocked(user) {
  if (!user) return false;
  if (isOwnerEmail(user.email)) return true;

  if (user.role === 'member' && user.memberOfOwnerId) {
    const owner = db.findUserByGoogleId(user.memberOfOwnerId);
    if (!owner) return false;
    return !!owner.unlocked || isOwnerEmail(owner.email);
  }

  return !!user.unlocked;
}

module.exports = { isOwnerEmail, isEffectivelyUnlocked, getOwnerEmails };
