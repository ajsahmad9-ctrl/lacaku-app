# Scalev Payment + Google Login (zero-dependency Node.js)

Aplikasi mandiri (bukan bagian dari Lacaku) yang mengimplementasikan:

1. **Login** dengan Google Identity Services (GIS), verifikasi ID token
   dilakukan sendiri di server memakai modul bawaan Node (`crypto`,
   `https`) - tanpa `google-auth-library`, tanpa `jsonwebtoken`, tanpa
   Firebase Auth, tanpa Passport.js.
2. **Pembayaran sekali-bayar** lewat [Scalev](https://scalev.co): user
   yang sudah login diarahkan (redirect halaman penuh, bukan iframe) ke
   halaman checkout Scalev; setelah bayar, Scalev mengirim webhook ke
   server, yang **selalu me-re-verifikasi status order langsung ke API
   Scalev** sebelum membuka akses (field `unlocked`) - tidak pernah
   percaya begitu saja pada isi body webhook.

Arsitekturnya sengaja dibuat sama dengan referensi yang sudah pernah
terbukti berjalan baik (proyek "Pregnancy Planner"): **zero-dependency**
(`package.json` tidak punya satu pun dependency), pakai server `http`
bawaan Node (tanpa Express), dan database berupa **file JSON** di
`data/users.json` (cukup untuk skala kecil-menengah; jangan dipakai untuk
trafik tinggi/concurrent write yang berat).

## Menjalankan secara lokal

```bash
npm install   # tidak ada dependency, tapi tetap aman dijalankan
cp .env.example .env
# lalu isi .env: GOOGLE_CLIENT_ID, SESSION_SECRET, SCALEV_API_KEY,
# SCALEV_CHECKOUT_URL, ADMIN_UNLOCK_SECRET
npm start
```

Server berjalan di `http://localhost:3000` (atau `PORT` yang diatur).

## Environment variables

| Variable | Wajib? | Keterangan |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Ya | OAuth 2.0 Client ID (Web application) dari Google Cloud Console. |
| `SESSION_SECRET` | Ya | String acak panjang untuk menandatangani cookie sesi. Jangan pernah kosong/placeholder di production. |
| `SCALEV_API_KEY` | Ya | API key rahasia Scalev, dipakai server untuk `GET /v3/orders/:id`. |
| `SCALEV_CHECKOUT_URL` | Ya | URL halaman checkout Scalev tujuan redirect tombol "Buka Semua". |
| `ADMIN_UNLOCK_SECRET` | Ya | Secret terpisah untuk endpoint admin unlock manual. Jangan pernah kosong di production. |
| `PORT` | Tidak (default 3000) | Port HTTP server. |
| `NODE_ENV` | Tidak | Set `production` di deployment supaya cookie sesi memakai atribut `Secure`. |

Kalau salah satu dari lima variabel wajib di atas tidak diatur, server akan
tetap menyala tapi mencetak **peringatan jelas ke log** saat startup
(`console.warn`), dan fitur terkait akan menampilkan error yang jelas saat
dipakai (bukan gagal diam-diam).

## Endpoint

| Method & Path | Keterangan |
|---|---|
| `GET /` | Halaman login (Google Sign-In). Kalau sudah login, redirect ke `/app`. |
| `GET /app` | Dashboard. Redirect ke `/` kalau belum login. |
| `GET /logout` | Hapus cookie sesi, redirect ke `/`. |
| `GET /checkout` | Redirect ke halaman checkout Scalev (kalau belum login -> `/`; kalau sudah `unlocked` -> `/app`). |
| `POST /api/auth/google` | Terima `{ credential }` (ID token dari GIS), verifikasi, buat/ambil user, set cookie sesi. |
| `GET /api/me` | Data user yang sedang login + status `unlocked`. Dipoll frontend tiap 4 detik di `/app`. |
| `POST /api/webhook/scalev` | Endpoint webhook Scalev. **Selalu membalas 200.** |
| `POST /api/admin/unlock` | Unlock manual `{ email }`, header `X-Admin-Secret` wajib cocok `ADMIN_UNLOCK_SECRET`. |

## Alur & keputusan desain penting

- **`unlocked` hanya bisa diubah lewat satu fungsi** (`unlockUserByEmail`
  di `src/unlock.js`, yang mendelegasikan ke `setUserUnlocked` di
  `src/db.js`) - dipanggil hanya dari webhook (setelah re-verifikasi) atau
  endpoint admin. Proses login (`upsertUserFromGoogle`) SENGAJA tidak
  pernah menyentuh field ini untuk user yang sudah ada, supaya login yang
  terjadi tepat setelah webhook memproses unlock tidak menimpanya balik
  jadi `false` (race condition).
- **Webhook selalu balas 200**, termasuk untuk ping validasi Scalev (body
  kosong / tidak ada `order_id`) - kalau tidak, Scalev akan menganggap
  endpoint gagal validasi dan tidak akan pernah mengirim webhook asli sama
  sekali.
- **`order_id` dicari di beberapa kemungkinan lokasi**: `payload.id`,
  `payload.order_id`, `payload.data.id`, `payload.data.order_id` (dicek
  berurutan, dipakai yang pertama ditemukan).
- **Status pembayaran TIDAK PERNAH dipercaya dari body webhook** - selalu
  di-re-verifikasi lewat `GET https://api.scalev.com/v3/orders/:id`
  dengan `Authorization: Bearer <SCALEV_API_KEY>`, sesuai rekomendasi
  resmi Scalev.
- **Semua hasil pemrosesan webhook dicatat lewat `console.log` /
  `console.warn` / `console.error`** - termasuk kalau email dari order
  tidak cocok dengan user manapun (`console.warn`, bukan silent fail),
  karena response HTTP ke Scalev sendiri tidak terlihat untuk keperluan
  debug kita.
- **Google ID token diverifikasi manual**: decode header/payload,
  ambil public key Google (`https://www.googleapis.com/oauth2/v3/certs`,
  di-cache 1 jam), cocokkan `kid`, verifikasi signature RS256, cek klaim
  `aud` (harus sama dengan `GOOGLE_CLIENT_ID`), `iss` (harus dari Google),
  dan `exp` (belum kedaluwarsa).
- **`sub` token Google dipakai sebagai `googleId`** (primary key permanen
  user), bukan email - karena email pada akun Google bisa berubah,
  sedangkan `sub` tidak pernah berubah.
- **`data-ux_mode="popup"`** (bukan `"redirect"`) pada tombol Google
  Sign-In - `redirect` mode pernah bermasalah di beberapa browser Android
  (mis. Samsung Internet) karena dibajak oleh Android App Links.
- **Checkout Scalev tidak pernah ditempel dalam iframe** - Scalev
  memblokir dirinya sendiri untuk ditampilkan dalam iframe (lewat
  `X-Frame-Options`/CSP), jadi tombol "Buka Semua" melakukan navigasi
  penuh (redirect 302) ke luar aplikasi kita.
- **Server tidak pernah membuat order Scalev sendiri** - halaman checkout
  Scalev-lah yang membuat order; server kita hanya membaca statusnya.

## Setup Google Cloud Console

1. Buka [Google Cloud Console](https://console.cloud.google.com/) > buat
   project baru (atau pakai yang sudah ada).
2. **APIs & Services > OAuth consent screen**: lengkapi info dasar
   (nama app, email support, dst). Untuk pemakaian publik, submit untuk
   verifikasi kalau diminta Google.
3. **APIs & Services > Credentials > Create Credentials > OAuth client
   ID**, pilih jenis **Web application**.
4. Di **Authorized JavaScript origins**, tambahkan domain production Anda
   PERSIS seperti yang akan diakses user, contoh: `https://app.contoh.com`
   - HARUS pakai `https://`, HARUS TANPA trailing slash di akhir.
   (Untuk testing lokal, tambahkan juga `http://localhost:3000`.)
5. Salin **Client ID** yang dihasilkan ke `GOOGLE_CLIENT_ID`.

Ulangi langkah ini (buat credential baru, atau update origins) setiap kali
aplikasi ini di-deploy ke domain baru.

## Deploy ke Railway + domain sendiri

1. Push project ini ke sebuah repo GitHub.
2. Di Railway, buat project baru > **Deploy from GitHub repo**, pilih repo
   ini. Railway otomatis mendeteksi `package.json` dan menjalankan
   `npm start`.
3. Railway akan memberi subdomain otomatis seperti
   `nama-service-production.up.railway.app` - dipakai dulu untuk testing
   awal.
4. Isi semua environment variable wajib (lihat tabel di atas) lewat tab
   **Variables** di Railway (JANGAN commit file `.env` ke repo).
5. **Settings > Networking > Custom Domain**: tambahkan domain Anda
   sendiri, lalu buat record **CNAME** di DNS provider Anda sesuai
   instruksi yang diberikan Railway.
6. Setelah domain custom aktif, **update dua tempat**:
   - Google Cloud Console: tambahkan domain custom ini ke *Authorized
     JavaScript origins*.
   - Dashboard Scalev: arahkan URL webhook ke
     `https://domain-anda.com/api/webhook/scalev` - **pakai domain custom
     yang stabil, BUKAN URL `*.up.railway.app`**, karena URL Railway bisa
     berubah.
7. Auto-deploy: setiap push ke branch `main` di GitHub akan otomatis
   memicu deploy baru di Railway (bawaan integrasi GitHub Railway, tidak
   perlu setup tambahan).

## Setup webhook Scalev

1. Di dashboard Scalev, cari pengaturan webhook untuk produk/paket Anda.
2. Masukkan URL: `https://domain-anda.com/api/webhook/scalev`.
3. Scalev biasanya akan mengirim satu **ping validasi** (body kosong atau
   tanpa `order_id`) untuk memastikan endpoint merespons `200 OK` -
   endpoint ini sudah menangani kasus tersebut secara eksplisit.
4. Lakukan transaksi uji (mode sandbox/test kalau Scalev
   menyediakannya) dan cek log server (`console.log` di webhook handler)
   untuk memastikan alur re-verifikasi -> unlock berjalan.

## Testing manual cepat (curl)

```bash
# Ping validasi webhook (body kosong) - harus 200
curl -i -X POST http://localhost:3000/api/webhook/scalev

# /api/me tanpa cookie - harus 401
curl -i http://localhost:3000/api/me

# /checkout tanpa login - harus redirect (302) ke /
curl -i http://localhost:3000/checkout

# Admin unlock dengan secret salah - harus 403
curl -i -X POST http://localhost:3000/api/admin/unlock \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: salah" \
  -d '{"email":"test@contoh.com"}'
```

## Keamanan & catatan lain

- Jangan pernah commit file `.env` atau `data/users.json` (lihat
  `.gitignore`) - keduanya bisa berisi secret/data pribadi user.
- `SESSION_SECRET` dan `ADMIN_UNLOCK_SECRET` **wajib** diganti dari nilai
  contoh sebelum dipakai di production - server akan mencetak peringatan
  di log kalau lupa, dan endpoint terkait akan menolak berjalan
  (`SESSION_SECRET`) atau menampilkan error jelas (`ADMIN_UNLOCK_SECRET`).
- Cookie sesi bersifat `HttpOnly` (tidak bisa diakses JavaScript di
  browser) dan mendapat atribut `Secure` otomatis saat `NODE_ENV=production`.
- File JSON (`data/users.json`) cukup untuk skala kecil-menengah; kalau
  aplikasi ini berkembang jadi produk yang dipakai banyak orang sekaligus,
  pertimbangkan migrasi ke database sungguhan (mis. PostgreSQL/Supabase).
