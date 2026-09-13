const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB - cukup untuk payload JSON kecil (login/webhook)

/**
 * Baca body request mentah lalu parse sebagai JSON. Sengaja ditulis manual
 * (tanpa express.json()/body-parser) karena server ini pakai `http` bawaan
 * Node, bukan framework. Body kosong dianggap objek kosong `{}` supaya
 * ping validasi webhook Scalev (yang kadang tidak mengirim body sama
 * sekali) tidak membuat proses ini melempar error.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        reject(new Error('Body request terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Body bukan JSON valid: ${err.message}`));
      }
    });

    req.on('error', reject);
  });
}

module.exports = { readJsonBody, MAX_BODY_BYTES };
