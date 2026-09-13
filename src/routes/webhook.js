const { readJsonBody } = require('../bodyParser');
const scalev = require('../scalev');
const { unlockUserByEmail } = require('../unlock');

function sendJson(res, statusCode, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function extractCustomerEmail(order) {
  if (!order || typeof order !== 'object') return null;
  const candidates = [
    order.customer_email,
    order.email,
    order.customer && order.customer.email,
    order.data && order.data.customer_email,
    order.data && order.data.email,
    order.data && order.data.customer && order.data.customer.email,
  ];
  const found = candidates.find((v) => typeof v === 'string' && v.trim());
  return found ? found.trim() : null;
}

function isPaid(order) {
  const status =
    (order && (order.payment_status || (order.data && order.data.payment_status))) || '';
  const normalized = String(status).toLowerCase();
  return normalized === 'paid' || normalized === 'settled';
}

/**
 * POST /api/webhook/scalev
 *
 * PALING PENTING: endpoint ini HARUS SELALU membalas 200 OK, apa pun yang
 * terjadi di dalamnya - termasuk untuk "ping validasi" yang dikirim Scalev
 * saat pertama kali menyimpan URL webhook ini (biasanya body kosong atau
 * tidak ada order_id sama sekali). Kalau endpoint ini membalas selain 200
 * untuk ping tersebut, Scalev akan menganggap endpoint GAGAL validasi dan
 * TIDAK AKAN PERNAH mengirim webhook sungguhan lagi saat ada pembayaran
 * asli - jadi ini bukan sekadar soal kerapian API, tapi syarat fungsional.
 *
 * Semua proses dilakukan dulu (await penuh) SEBELUM membalas, supaya kode
 * simpel dan berurutan; response HTTP ke Scalev sendiri tidak dilihat siapa
 * pun untuk debugging, jadi SETIAP hasil (sukses, ping, order belum lunas,
 * gagal verifikasi, email tidak cocok) WAJIB dicatat lewat console.log /
 * console.warn / console.error supaya bisa dilihat di log deployment
 * (Railway/Vercel dst).
 *
 * Alur inti (WAJIB, sesuai instruksi eksplisit user):
 *  1. Ambil order_id dari body (cek beberapa kemungkinan lokasi).
 *  2. Kalau tidak ada order_id -> kemungkinan besar ini ping validasi ->
 *     log + balas 200, JANGAN panggil API Scalev sama sekali.
 *  3. Kalau ada order_id -> JANGAN PERCAYA payment_status dari body webhook
 *     -> re-verifikasi dengan GET ke API Scalev pakai SCALEV_API_KEY.
 *  4. Hanya kalau hasil re-verifikasi itu paid/settled DAN ada email
 *     customer -> panggil unlockUserByEmail(email) (satu-satunya fungsi
 *     yang boleh mengubah field `unlocked`).
 *  5. Kalau user dengan email itu tidak ditemukan -> log WARNING yang
 *     jelas (bukan gagal diam-diam) - admin bisa pakai endpoint
 *     /api/admin/unlock untuk perbaikan manual.
 */
async function handleScalevWebhook(req, res) {
  let payload = {};
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    console.error('[webhook] Gagal parse body webhook Scalev (tetap balas 200):', err.message);
    sendJson(res, 200, { ok: true, note: 'body tidak bisa diparse, diabaikan' });
    return;
  }

  const orderId = scalev.extractOrderId(payload);

  if (!orderId) {
    console.log(
      '[webhook] Tidak ada order_id di body - kemungkinan ini ping validasi endpoint dari ' +
        'Scalev. Membalas 200 tanpa memanggil API Scalev.'
    );
    sendJson(res, 200, { ok: true, note: 'tidak ada order_id, dianggap ping validasi' });
    return;
  }

  let order;
  try {
    order = await scalev.getOrderStatus(orderId);
  } catch (err) {
    console.error(
      `[webhook] Gagal re-verifikasi order_id=${orderId} ke API Scalev:`,
      err.message
    );
    sendJson(res, 200, { ok: true, note: 'gagal re-verifikasi ke API Scalev, lihat log server' });
    return;
  }

  if (!isPaid(order)) {
    console.log(
      `[webhook] order_id=${orderId} belum berstatus paid/settled (status: ` +
        `${order && (order.payment_status || (order.data && order.data.payment_status))}). Diabaikan.`
    );
    sendJson(res, 200, { ok: true, note: 'order belum paid/settled' });
    return;
  }

  const email = extractCustomerEmail(order);
  if (!email) {
    console.error(
      `[webhook] order_id=${orderId} berstatus paid/settled TAPI tidak ada email customer ` +
        'yang bisa ditemukan di response Scalev. Tidak bisa unlock otomatis - cek data order ' +
        'ini secara manual, atau gunakan endpoint /api/admin/unlock.'
    );
    sendJson(res, 200, { ok: true, note: 'paid tapi email customer tidak ditemukan' });
    return;
  }

  try {
    const user = unlockUserByEmail(email);
    console.log(
      `[webhook] order_id=${orderId} paid/settled - user email=${email} berhasil di-unlock ` +
        `(userId=${user.id}).`
    );
  } catch (err) {
    console.warn(
      `[webhook] order_id=${orderId} paid/settled dengan email=${email}, TAPI email tsb tidak ` +
        `cocok dengan user manapun yang pernah login: ${err.message}`
    );
  }

  sendJson(res, 200, { ok: true });
}

module.exports = { handleScalevWebhook };
