const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { loadEnvFile } = require('./src/loadEnv');
loadEnvFile();

const { serveLoginPage, serveAppPage, PUBLIC_DIR } = require('./src/routes/pages');
const { handleGoogleAuth, handleLogout } = require('./src/routes/auth');
const { handleMe } = require('./src/routes/me');
const { handleCheckout } = require('./src/routes/checkout');
const { handleScalevWebhook } = require('./src/routes/webhook');
const { handleAdminUnlock } = require('./src/routes/admin');
const { handleTeamList, handleTeamAdd, handleTeamRemove } = require('./src/routes/team');

const PORT = process.env.PORT || 3000;

const REQUIRED_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'SESSION_SECRET',
  'SCALEV_API_KEY',
  'SCALEV_CHECKOUT_URL',
  'ADMIN_UNLOCK_SECRET',
];

function warnMissingEnvVars() {
  REQUIRED_ENV_VARS.forEach((key) => {
    if (!process.env[key]) {
      console.warn(`[startup] PERINGATAN: environment variable ${key} belum diatur.`);
    }
  });
  if (process.env.SESSION_SECRET === 'ganti-dengan-string-acak-panjang-anda-sendiri') {
    console.warn(
      '[startup] PERINGATAN: SESSION_SECRET masih memakai nilai contoh/placeholder. ' +
        'Ganti dengan string acak yang panjang sebelum dipakai di production!'
    );
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Static file server sederhana untuk apa pun di public/ yang bukan
 * index.html / app.html (mis. kalau nanti ditambah CSS/JS/gambar
 * terpisah). Ada guard path-traversal sederhana: path hasil resolve harus
 * tetap berada di dalam PUBLIC_DIR.
 */
function serveStaticFile(req, res, pathname) {
  const relative = pathname.replace(/^\/+/, '');
  const candidate = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!candidate.startsWith(PUBLIC_DIR)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  fs.readFile(candidate, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(candidate).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url);
    const pathname = parsed.pathname;

    if (req.method === 'GET' && pathname === '/') {
      serveLoginPage(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/app') {
      serveAppPage(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/logout') {
      handleLogout(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/checkout') {
      handleCheckout(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/auth/google') {
      handleGoogleAuth(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/me') {
      handleMe(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/webhook/scalev') {
      handleScalevWebhook(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/admin/unlock') {
      handleAdminUnlock(req, res);
      return;
    }
    if (req.method === 'GET' && pathname === '/api/team') {
      handleTeamList(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/team/add') {
      handleTeamAdd(req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/team/remove') {
      handleTeamRemove(req, res);
      return;
    }
    if (req.method === 'GET') {
      serveStaticFile(req, res, pathname);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (err) {
    console.error('[server] Error tidak terduga saat memproses request:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
    }
  }
});

warnMissingEnvVars();

server.listen(PORT, () => {
  console.log(`[startup] Server berjalan di http://localhost:${PORT}`);
});
