const https = require('https');

const SCALEV_API_BASE = 'https://api.scalev.com/v3';

/**
 * Ambil status order LANGSUNG dari API Scalev (bukan dari body webhook).
 * Ini yang dipakai untuk re-verifikasi wajib sebelum unlock - sesuai
 * rekomendasi resmi Scalev: JANGAN PERNAH percaya begitu saja pada
 * `payment_status` yang dikirim di body webhook, karena body webhook bisa
 * dipalsukan siapa pun yang tahu URL endpoint kita. Satu-satunya sumber
 * kebenaran adalah hasil GET ini, yang diautentikasi pakai API key rahasia
 * kita sendiri.
 */
function getOrderStatus(orderId) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.SCALEV_API_KEY;
    if (!apiKey) {
      reject(new Error('SCALEV_API_KEY belum diatur di environment variable.'));
      return;
    }
    if (!orderId) {
      reject(new Error('orderId kosong, tidak bisa verifikasi ke Scalev.'));
      return;
    }

    const url = `${SCALEV_API_BASE}/orders/${encodeURIComponent(orderId)}`;

    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                `GET ${url} gagal, status ${res.statusCode}, body: ${data.slice(0, 500)}`
              )
            );
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Gagal parse response Scalev sebagai JSON: ${err.message}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * order_id bisa muncul di beberapa kemungkinan lokasi tergantung bentuk
 * payload webhook yang dikirim Scalev (payload.id, payload.order_id,
 * payload.data.id, payload.data.order_id). Cek semuanya, ambil yang pertama
 * ditemukan. Kalau tidak ada satu pun, kemungkinan besar ini ping validasi
 * endpoint dari Scalev (bukan webhook order sungguhan) - lihat routes/webhook.js.
 */
function extractOrderId(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : null;

  if (payload.id) return payload.id;
  if (payload.order_id) return payload.order_id;
  if (data && data.id) return data.id;
  if (data && data.order_id) return data.order_id;
  return null;
}

module.exports = { SCALEV_API_BASE, getOrderStatus, extractOrderId };
