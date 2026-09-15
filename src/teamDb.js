const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('./db');

const TEAM_DB_PATH = path.join(__dirname, '..', 'data', 'team_members.json');

/**
 * Penyimpanan "anggota tim": daftar email yang didaftarkan oleh seorang
 * owner supaya, begitu email itu login Google ke aplikasi ini, otomatis
 * digabungkan ke workspace Lacaku milik owner tersebut (bukan dibuatkan
 * workspace baru yang kosong terpisah) - lihat catatan di db.js
 * (attachUserToWorkspace/detachUserFromWorkspace) dan ownerAccess.js
 * (akses efektif anggota tim mengikuti status `unlocked` owner-nya).
 *
 * Satu email HANYA BOLEH aktif di SATU workspace pada satu waktu (lihat
 * findActiveMembership) - kalau perlu pindah, owner lama harus
 * mencabutnya dulu.
 */

function ensureDbFile() {
  const dir = path.dirname(TEAM_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(TEAM_DB_PATH)) fs.writeFileSync(TEAM_DB_PATH, '[]', 'utf8');
}

function readTeamMembers() {
  ensureDbFile();
  const raw = fs.readFileSync(TEAM_DB_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[teamDb] Gagal parse team_members.json, mengembalikan array kosong:', err.message);
    return [];
  }
}

function writeTeamMembers(members) {
  ensureDbFile();
  const tmpPath = `${TEAM_DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(members, null, 2), 'utf8');
  fs.renameSync(tmpPath, TEAM_DB_PATH);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Undangan/keanggotaan tim yang masih aktif untuk sebuah email (kalau ada).
 * "Aktif" berarti belum dicabut owner (status !== 'revoked') - dipakai saat
 * login (auth.js) untuk menentukan apakah user ini harus digabungkan ke
 * workspace tim, dan saat menambah anggota baru (routes/team.js) untuk
 * mencegah satu email dobel jadi anggota dua workspace sekaligus.
 */
function findActiveMembership(email) {
  const target = normalizeEmail(email);
  if (!target) return null;
  return (
    readTeamMembers().find((m) => m.email === target && m.status === 'active') || null
  );
}

function listTeamMembers(ownerId) {
  return readTeamMembers()
    .filter((m) => m.ownerId === ownerId)
    .sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));
}

/**
 * Tambah (atau aktifkan-ulang) anggota tim untuk seorang owner. Kalau
 * sebelumnya pernah ada baris untuk pasangan (ownerId,email) yang sama
 * (misalnya pernah dicabut lalu diundang lagi), baris lama dipakai ulang
 * supaya riwayat gabung (`joinedGoogleId`/`joinedAt`) tidak hilang percuma.
 */
function addTeamMember({ ownerId, ownerEmail, email, divisi }) {
  const members = readTeamMembers();
  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();

  const idx = members.findIndex((m) => m.ownerId === ownerId && m.email === normalizedEmail);
  if (idx !== -1) {
    members[idx] = {
      ...members[idx],
      divisi: divisi || null,
      status: 'active',
      updatedAt: now,
    };
    writeTeamMembers(members);
    return members[idx];
  }

  const entry = {
    id: crypto.randomBytes(9).toString('base64url'),
    ownerId,
    ownerEmail: normalizeEmail(ownerEmail),
    email: normalizedEmail,
    divisi: divisi || null,
    status: 'active',
    joinedGoogleId: null,
    joinedAt: null,
    addedAt: now,
    updatedAt: now,
  };
  members.push(entry);
  writeTeamMembers(members);
  return entry;
}

/**
 * Cabut akses anggota tim. Kalau anggota itu SUDAH PERNAH login/gabung
 * (`joinedGoogleId` terisi), pemanggil (routes/team.js) bertanggung jawab
 * memanggil db.detachUserFromWorkspace() juga supaya akses ke data
 * workspace benar-benar terputus seketika, bukan cuma baris ini yang
 * ditandai revoked.
 */
function removeTeamMember({ ownerId, email }) {
  const members = readTeamMembers();
  const normalizedEmail = normalizeEmail(email);
  const idx = members.findIndex(
    (m) => m.ownerId === ownerId && m.email === normalizedEmail && m.status === 'active'
  );
  if (idx === -1) return null;
  members[idx] = { ...members[idx], status: 'revoked', updatedAt: new Date().toISOString() };
  writeTeamMembers(members);
  return members[idx];
}

function markJoined(membershipId, googleId) {
  const members = readTeamMembers();
  const idx = members.findIndex((m) => m.id === membershipId);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  members[idx] = { ...members[idx], joinedGoogleId: googleId, joinedAt: now, updatedAt: now };
  writeTeamMembers(members);
  return members[idx];
}

/**
 * Dipanggil di SETIAP login (baru maupun lama) dari auth.js - "menyamakan"
 * status workspace user dengan keanggotaan tim yang aktif saat ini:
 *  - Kalau email user punya keanggotaan aktif milik owner LAIN, dan user
 *    belum tergabung ke workspace itu -> gabungkan (attachUserToWorkspace).
 *  - Kalau user sedang berstatus 'member' tapi keanggotaannya sudah TIDAK
 *    aktif lagi (dicabut, atau baris hilang) -> lepaskan
 *    (detachUserFromWorkspace) sebagai jaring pengaman tambahan, di luar
 *    pemutusan langsung yang sudah dilakukan routes/team.js saat dicabut.
 * Sengaja idempotent & aman dipanggil berkali-kali.
 */
function syncMembershipOnLogin(user) {
  if (!user) return user;
  const membership = findActiveMembership(user.email);

  if (membership && membership.ownerId !== user.id) {
    const owner = db.findUserByGoogleId(membership.ownerId);
    if (owner) {
      const alreadyAttached =
        user.role === 'member' &&
        user.memberOfOwnerId === owner.id &&
        user.workspaceId === owner.workspaceId;
      if (!alreadyAttached) {
        const updated = db.attachUserToWorkspace(user.id, {
          workspaceId: owner.workspaceId,
          memberOfOwnerId: owner.id,
          divisi: membership.divisi,
        });
        markJoined(membership.id, user.id);
        return updated || user;
      }
      return user;
    }
  }

  if (!membership && user.role === 'member') {
    return db.detachUserFromWorkspace(user.id) || user;
  }

  return user;
}

module.exports = {
  TEAM_DB_PATH,
  readTeamMembers,
  writeTeamMembers,
  findActiveMembership,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  markJoined,
  syncMembershipOnLogin,
};
