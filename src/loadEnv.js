const fs = require('fs');
const path = require('path');

/**
 * Loader .env yang sangat sederhana (TANPA dependency `dotenv`) - sengaja
 * ditulis manual supaya package.json tetap zero-dependency, sesuai
 * arsitektur Pregnancy Planner (murni Node.js built-in, tanpa npm install
 * apa pun). Ini cuma dipakai untuk memudahkan development lokal.
 *
 * Di Railway/production, environment variable diatur langsung lewat
 * dashboard Railway (Variables tab) - file .env biasanya TIDAK ADA di sana
 * sama sekali, dan memang seharusnya tidak pernah di-commit ke git (lihat
 * .gitignore).
 */
function loadEnvFile(envPath = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) return;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Jangan timpa env var yang sudah diset dari luar (mis. oleh Railway).
    if (!(key in process.env)) process.env[key] = value;
  });
}

module.exports = { loadEnvFile };
