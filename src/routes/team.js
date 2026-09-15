const session = require('../session');
const db = require('../db');
const teamDb = require('../teamDb');
const { readJsonBody } = require('../bodyParser');

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Semua endpoint di file ini hanya boleh dipakai owner (bukan anggota tim)
 * untuk mengelola TIM MEREKA SENDIRI - anggota tim tidak boleh mengelola
 * anggota tim lain (termasuk anggota tim workspace-nya sendiri).
 */
function requireOwner(req, res) {
  const sessionData = session.getSessionFromRequest(req);
  if (!sessionData || !sessionData.googleId) {
    sendJson(res, 401, { ok: false, error: 'Belum login.' });
    return null;
  }
  const user = db.findUserByGoogleId(sessionData.googleId);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'User tidak ditemukan.' });
    return null;
  }
  if (user.role === 'member') {
    sendJson(res, 403, { ok: false, error: 'Anggota tim tidak bisa mengelola anggota tim.' });
    return null;
  }
  return user;
}

/**
 * GET /api/team
 *
 * Daftar anggota tim milik owner yang sedang login (termasuk yang belum
 * pernah login/"joined" - statusnya tetap ditampilkan supaya owner tahu
 * mana yang belum membuka undangannya).
 */
function handleTeamList(req, res) {
  const owner = requireOwner(req, res);
  if (!owner) return;

  const members = teamDb.listTeamMembers(owner.id).map((m) => ({
    email: m.email,
    divisi: m.divisi,
    status: m.status,
    joined: !!m.joinedGoogleId,
    addedAt: m.addedAt,
  }));
  sendJson(res, 200, { ok: true, members });
}

/**
 * POST /api/team/add  { email, divisi }
 *
 * Daftarkan sebuah email supaya, begitu orang itu login Google lewat
 * halaman ini, otomatis masuk ke workspace Lacaku yang sama dengan owner
 * (bukan dibuatkan workspace baru yang kosong). "divisi" cuma label bebas
 * untuk catatan owner sendiri (mis. "CS", "Admin Gudang") - TIDAK
 * menentukan role di dalam Lacaku, karena Lacaku punya pemilihan
 * nama+role sendiri begitu dibuka.
 */
async function handleTeamAdd(req, res) {
  const owner = requireOwner(req, res);
  if (!owner) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: 'Body request tidak valid.' });
    return;
  }

  const email = String((body && body.email) || '').trim().toLowerCase();
  const divisi = String((body && body.divisi) || '').trim().slice(0, 60);

  if (!email || !EMAIL_RE.test(email)) {
    sendJson(res, 400, { ok: false, error: 'Email tidak valid.' });
    return;
  }
  if (email === String(owner.email || '').trim().toLowerCase()) {
    sendJson(res, 400, { ok: false, error: 'Tidak bisa menambahkan email Anda sendiri sebagai anggota tim.' });
    return;
  }

  // Kalau email ini SUDAH PERNAH login sebagai akun tersendiri (owner) yang
  // bukan anggota tim siapa pun, JANGAN otomatis "diambil alih" jadi
  // anggota tim - itu bisa diam-diam memindahkan akun/data orang lain.
  const existingUser = db.findUserByEmail(email);
  if (existingUser && existingUser.role !== 'member' && existingUser.id !== owner.id) {
    sendJson(res, 409, {
      ok: false,
      error:
        'Email ini sudah pernah login sebagai akun Lacaku tersendiri, jadi tidak bisa otomatis dijadikan anggota tim.',
    });
    return;
  }

  const existingMembership = teamDb.findActiveMembership(email);
  if (existingMembership && existingMembership.ownerId !== owner.id) {
    sendJson(res, 409, { ok: false, error: 'Email ini sudah menjadi anggota tim workspace lain.' });
    return;
  }

  const entry = teamDb.addTeamMember({ ownerId: owner.id, ownerEmail: owner.email, email, divisi });

  // Kalau email ini KEBETULAN sudah punya akun (login sebelumnya) - entah
  // sudah jadi member kita sebelumnya (re-invite) atau baru saja lolos
  // pengecekan di atas karena belum pernah dipakai sama sekali sebagai
  // owner - langsung sinkronkan sekarang juga, tidak usah menunggu mereka
  // login ulang.
  if (existingUser) {
    teamDb.syncMembershipOnLogin(existingUser);
  }

  sendJson(res, 200, {
    ok: true,
    member: { email: entry.email, divisi: entry.divisi, status: entry.status },
  });
}

/**
 * POST /api/team/remove  { email }
 *
 * Cabut akses anggota tim. Kalau orang itu sudah pernah login/gabung,
 * aksesnya ke workspace ini terputus SEKETIKA (lihat
 * db.detachUserFromWorkspace - mereka dipindah ke workspace baru yang
 * kosong milik mereka sendiri).
 */
async function handleTeamRemove(req, res) {
  const owner = requireOwner(req, res);
  if (!owner) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: 'Body request tidak valid.' });
    return;
  }

  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!email) {
    sendJson(res, 400, { ok: false, error: 'Email wajib diisi.' });
    return;
  }

  const removed = teamDb.removeTeamMember({ ownerId: owner.id, email });
  if (!removed) {
    sendJson(res, 404, { ok: false, error: 'Anggota tim tidak ditemukan.' });
    return;
  }

  if (removed.joinedGoogleId) {
    db.detachUserFromWorkspace(removed.joinedGoogleId);
  }

  sendJson(res, 200, { ok: true });
}

module.exports = { handleTeamList, handleTeamAdd, handleTeamRemove };
