const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'users.json');

/**
 * Bikin ID workspace baru: dipakai Lacaku (lewat parameter URL
 * "?workspace=<id>") untuk memisahkan data satu bisnis/pelanggan dari bisnis
 * lain, karena semuanya memakai artifact Lacaku yang sama (lihat
 * wrapDbForWorkspace() di kode Lacaku). Panjang & acak (18 byte random,
 * base64url ~24 karakter) supaya praktis tidak bisa ditebak - ini SATU-
 * SATUNYA lapisan pemisah data yang ada saat ini (bukan otentikasi
 * kriptografis sungguhan di sisi Lacaku), jadi jangan pernah dibuat pendek
 * atau mudah ditebak.
 */
function generateWorkspaceId() {
  return crypto.randomBytes(18).toString('base64url');
}

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]', 'utf8');
}

function readUsers() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[db] Gagal parse users.json, mengembalikan array kosong:', err.message);
    return [];
  }
}

function writeUsers(users) {
  ensureDbFile();
  // Tulis ke file sementara dulu lalu rename - supaya kalau proses mati di
  // tengah penulisan (crash/restart), users.json yang lama tidak jadi
  // rusak/setengah tertulis. rename() pada filesystem yang sama bersifat
  // atomik.
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

function findUserByGoogleId(googleId) {
  return readUsers().find((u) => u.googleId === googleId) || null;
}

function findUserByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return null;
  return readUsers().find((u) => String(u.email || '').trim().toLowerCase() === target) || null;
}

/**
 * Cari user berdasarkan googleId (sub token Google - primary key permanen,
 * BUKAN email, karena email pada akun Google bisa berubah sementara sub
 * tidak pernah berubah). Kalau belum ada, buat baru dengan unlocked:false.
 *
 * PENTING - proteksi race condition: kalau user SUDAH ADA sebelumnya, field
 * `unlocked`/`unlockedAt` SENGAJA TIDAK DISENTUH SAMA SEKALI di sini. Field
 * itu hanya boleh diubah lewat unlockUserByEmail() (lihat unlock.js). Kalau
 * proses login ini ikut menimpa balik `unlocked` jadi false, user yang baru
 * saja di-unlock oleh webhook Scalev bisa "terkunci lagi" secara tidak
 * sengaja - itulah bug yang pernah terjadi dan sengaja dihindari di sini.
 */
function upsertUserFromGoogle({ googleId, email, name, picture }) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.googleId === googleId);
  const now = new Date().toISOString();

  if (idx === -1) {
    const newUser = {
      id: googleId,
      googleId,
      email,
      name,
      picture,
      unlocked: false,
      unlockedAt: null,
      workspaceId: generateWorkspaceId(),
      // role 'owner' = akun yang login & (biasanya) bayar sendiri, punya
      // workspace sendiri. role 'member' = anggota tim yang didaftarkan oleh
      // seorang owner (lihat teamDb.js/attachUserToWorkspace di bawah) dan
      // memakai workspace + status langganan MILIK OWNER-nya, bukan miliknya
      // sendiri.
      role: 'owner',
      memberOfOwnerId: null,
      divisi: null,
      createdAt: now,
      updatedAt: now,
    };
    users.push(newUser);
    writeUsers(users);
    return newUser;
  }

  users[idx] = { ...users[idx], email, name, picture, updatedAt: now };
  writeUsers(users);
  return users[idx];
}

/**
 * Jadikan user (yang sudah ada) sebagai anggota tim workspace milik owner
 * tertentu: workspace & akses efektifnya (lihat ownerAccess.js) mengikuti
 * owner tersebut, BUKAN status `unlocked` miliknya sendiri. Dipanggil dari
 * alur login (auth.js) begitu terdeteksi email yang login cocok dengan
 * undangan tim yang masih aktif (lihat teamDb.js).
 */
function attachUserToWorkspace(userId, { workspaceId, memberOfOwnerId, divisi }) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  users[idx] = {
    ...users[idx],
    role: 'member',
    workspaceId,
    memberOfOwnerId,
    divisi: divisi || null,
    updatedAt: now,
  };
  writeUsers(users);
  return users[idx];
}

/**
 * Lepaskan user dari workspace tim (dipakai saat owner menghapus/mencabut
 * akses anggota tim - lihat routes/team.js). User diberi workspace BARU yang
 * kosong miliknya sendiri (role kembali 'owner', unlocked:false) supaya
 * akses ke data workspace tim yang lama benar-benar terputus SEKETIKA, bukan
 * menunggu logout/login ulang - bukan cuma "ditandai" tapi id workspace-nya
 * betul-betul berubah.
 */
function detachUserFromWorkspace(userId) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  users[idx] = {
    ...users[idx],
    role: 'owner',
    memberOfOwnerId: null,
    divisi: null,
    workspaceId: generateWorkspaceId(),
    updatedAt: now,
  };
  writeUsers(users);
  return users[idx];
}

/**
 * Ambil workspaceId milik user; kalau belum punya (mis. akun yang dibuat
 * SEBELUM fitur multi-tenant ini ada), buatkan satu baru dan simpan
 * ("self-healing") - supaya user lama tidak pernah stuck tanpa workspaceId.
 */
function getOrCreateWorkspaceId(userId) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;

  if (users[idx].workspaceId) return users[idx].workspaceId;

  const workspaceId = generateWorkspaceId();
  users[idx].workspaceId = workspaceId;
  users[idx].updatedAt = new Date().toISOString();
  writeUsers(users);
  return workspaceId;
}

/**
 * SATU-SATUNYA tempat di seluruh aplikasi yang boleh mengubah field
 * `unlocked`. Dipanggil hanya dari unlockUserByEmail() (unlock.js), yang
 * pada gilirannya hanya dipanggil dari webhook Scalev (setelah re-verifikasi
 * API) atau endpoint admin unlock manual.
 */
function setUserUnlocked(userId, unlocked) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  users[idx].unlocked = unlocked;
  if (unlocked) users[idx].unlockedAt = now;
  users[idx].updatedAt = now;
  writeUsers(users);
  return users[idx];
}

module.exports = {
  DB_PATH,
  readUsers,
  writeUsers,
  findUserByGoogleId,
  findUserByEmail,
  upsertUserFromGoogle,
  setUserUnlocked,
  getOrCreateWorkspaceId,
  attachUserToWorkspace,
  detachUserFromWorkspace,
};
