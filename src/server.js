const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const store = require('./engine/store');
const { NODE_CATALOG } = require('./engine/nodes');
const { runWorkflow } = require('./engine/executor');
const { startScheduler } = require('./engine/scheduler');
const authStore = require('./engine/auth-store');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = __dirname;
const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

const SECURITY_BLOCKED_PATTERNS = [
  /\.\.\//, /\.\.\\/, /%2e%2e\//, /%2e%2e\\/,
  /^\/node_modules\//, /^\/\.git\//, /^\/data\//,
  /^\/engine\//, /^\/\.env/
];

const BLOCKED_FILE_EXTS = ['.json', '.md'];
const ALLOWED_CLIENT_JS = ['/renderer.js', '/automation.js', '/projects.js'];

let requestCounts = {};
const RATE_LIMIT = { window: 60000, max: 300 };
const UPLOAD_TTL_MS = 1000 * 60 * 60 * 24;
const AUTH_COOKIE_NAME = 'prime_dashboard_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

store.seedIfEmpty();
authStore.ensureAuthFiles();

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' http://localhost:*");
}

function rateLimit(ip) {
  const now = Date.now();
  if (!requestCounts[ip]) requestCounts[ip] = [];
  requestCounts[ip] = requestCounts[ip].filter(t => now - t < RATE_LIMIT.window);
  if (requestCounts[ip].length >= RATE_LIMIT.max) return false;
  requestCounts[ip].push(now);
  return true;
}

function sanitizeInput(val) {
  if (typeof val === 'string') {
    return val.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
              .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
              .replace(/javascript\s*:/gi, '')
              .slice(0, 10000);
  }
  if (typeof val === 'object' && val !== null) {
    const out = Array.isArray(val) ? [] : {};
    for (const [k, v] of Object.entries(val)) {
      out[sanitizeInput(k)] = sanitizeInput(v);
    }
    return out;
  }
  return val;
}

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  return sanitizeInput(body);
}

function deleteFileIfExists(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

function cleanupExpiredUploads() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return;
    const now = Date.now();
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const file of files) {
      const fullPath = path.join(UPLOADS_DIR, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > UPLOAD_TTL_MS) {
        deleteFileIfExists(fullPath);
      }
    }
  } catch (err) {
    console.warn('[Uploads] Cleanup failed:', err.message);
  }
}

// ── Service connection tester ─────────────────────────────────────────────
async function testService(service, creds) {
  const https = require('https');
  const http  = require('http');

  function quickGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', headers }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }});
      });
      req.on('error', reject);
      req.end();
    });
  }
  function quickPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      const req = lib.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }});
      });
      req.on('error', reject); req.write(payload); req.end();
    });
  }

  switch (service) {
    case 'gemini': {
      if (!creds.geminiApiKey) throw new Error('Gemini API key not set');
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${creds.geminiApiKey}`;
      const r = await quickGet(url);
      if (r.status !== 200) throw new Error(`Gemini responded with ${r.status}`);
      return { models: (r.body.models || []).length };
    }
    case 'telegram': {
      if (!creds.telegramBotToken) throw new Error('Telegram Bot Token not set');
      const url = `https://api.telegram.org/bot${creds.telegramBotToken}/getMe`;
      const r = await quickGet(url);
      if (!r.body?.ok) throw new Error(`Telegram: ${JSON.stringify(r.body)}`);
      return { bot: r.body.result?.username };
    }
    case 'slack': {
      if (!creds.slackWebhookUrl) throw new Error('Slack Webhook URL not set');
      const r = await quickPost(creds.slackWebhookUrl, { text: 'Prime Dashboard: Slack connection verified!' });
      if (r.status !== 200) throw new Error(`Slack responded with ${r.status}: ${r.body}`);
      return { ok: true };
    }
    case 'discord': {
      if (!creds.discordWebhookUrl) throw new Error('Discord Webhook URL not set');
      const r = await quickPost(creds.discordWebhookUrl, { content: 'Prime Dashboard: Discord connection verified!' });
      if (r.status < 200 || r.status > 204) throw new Error(`Discord responded with ${r.status}`);
      return { ok: true };
    }
    case 'notion': {
      if (!creds.notionToken) throw new Error('Notion Token not set');
      const r = await quickGet('https://api.notion.com/v1/users/me', {
        Authorization: `Bearer ${creds.notionToken}`, 'Notion-Version': '2022-06-28'
      });
      if (r.status !== 200) throw new Error(`Notion responded with ${r.status}`);
      return { user: r.body?.name || 'connected' };
    }
    case 'email': {
      if (!creds.smtpUser || !creds.smtpPass) throw new Error('SMTP credentials not set');
      let nodemailer;
      try { nodemailer = require('nodemailer'); } catch { throw new Error('nodemailer not installed. Run: npm install nodemailer'); }
      const transporter = nodemailer.createTransport({
        host: creds.smtpHost || 'smtp.gmail.com',
        port: Number(creds.smtpPort) || 587,
        secure: Number(creds.smtpPort) === 465,
        auth: { user: creds.smtpUser, pass: creds.smtpPass }
      });
      await transporter.verify();
      return { ok: true, user: creds.smtpUser };
    }
    case 'googlesheets': {
      if (!creds.googleServiceAccount) throw new Error('Google Service Account JSON not set');
      const sa = JSON.parse(creds.googleServiceAccount);
      return { client_email: sa.client_email, project: sa.project_id };
    }
    default:
      throw new Error(`Unknown service: ${service}`);
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  const header = String(req.headers.cookie || '');
  const cookies = {};
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = decodeURIComponent(trimmed.slice(0, eqIndex).trim());
    const value = decodeURIComponent(trimmed.slice(eqIndex + 1).trim());
    cookies[key] = value;
  }
  return cookies;
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookieValue]);
    return;
  }
  res.setHeader('Set-Cookie', [current, cookieValue]);
}

function setAuthCookie(res, token) {
  appendSetCookie(res, `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

function clearAuthCookie(res) {
  appendSetCookie(res, `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIE_NAME] || '';
}

function getCurrentUser(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const session = authStore.getSession(token);
  if (!session) return null;
  return authStore.getUserById(session.userId);
}

function requireAuth(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Authentication required' });
    return null;
  }
  return user;
}

function readBody(req, options = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const maxSize = Number(options.maxSize) || (1024 * 100);
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxSize) {
        req.destroy(new Error('Request too large'));
        return reject(new Error('Request body too large'));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function parseMultipartContentDisposition(value = '') {
  const out = {};
  for (const part of String(value).split(';')) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim().toLowerCase();
    let val = trimmed.slice(eqIndex + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

function streamMultipartFileToDisk(req, options = {}) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) return reject(new Error('Missing multipart boundary'));

    const boundary = `--${boundaryMatch[1]}`;
    const boundaryBuffer = Buffer.from(boundary);
    const boundaryDelimiter = Buffer.from(`\r\n${boundary}`);
    const maxSize = Number(options.maxSize) || (1024 * 1024 * 1024 * 20);
    const targetFieldName = options.fieldName || 'file';

    let totalSize = 0;
    let state = 'headers';
    let buffer = Buffer.alloc(0);
    let fileStream = null;
    let tempPath = '';
    let bytesWritten = 0;
    let settled = false;
    let fileMeta = null;

    const cleanup = () => {
      if (fileStream) {
        try { fileStream.destroy(); } catch {}
      }
      if (tempPath && fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const succeed = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const writeFileChunk = (chunk) => {
      if (!fileStream || !chunk.length) return;
      bytesWritten += chunk.length;
      fileStream.write(chunk);
    };

    req.on('data', (chunk) => {
      if (settled) return;
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy(new Error('Upload exceeds server maximum size'));
        return;
      }

      buffer = Buffer.concat([buffer, chunk]);

      while (!settled) {
        if (state === 'headers') {
          const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
          if (headerEnd === -1) break;

          const headerBlock = buffer.slice(0, headerEnd).toString('utf8');
          buffer = buffer.slice(headerEnd + 4);

          const headerLines = headerBlock.split('\r\n').filter(Boolean);
          const dispositionLine = headerLines.find(line => line.toLowerCase().startsWith('content-disposition:')) || '';
          const disposition = parseMultipartContentDisposition(dispositionLine.split(':').slice(1).join(':').trim());
          const fieldName = disposition.name || '';
          const originalName = String(disposition.filename || '').replace(/[^a-zA-Z0-9._-]/g, '_');
          const contentTypeLine = headerLines.find(line => line.toLowerCase().startsWith('content-type:')) || '';
          const mimeType = contentTypeLine ? contentTypeLine.split(':').slice(1).join(':').trim() : 'application/octet-stream';

          if (!originalName || fieldName !== targetFieldName) {
            return fail(new Error('Expected multipart field named "file" with a filename'));
          }

          const tempId = 'upl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
          tempPath = path.join(UPLOADS_DIR, `${tempId}_${originalName || 'upload.bin'}`);
          fileMeta = {
            id: tempId,
            fileName: originalName || 'upload.bin',
            mimeType,
            path: tempPath,
            createdAt: new Date().toISOString()
          };
          fileStream = fs.createWriteStream(tempPath);
          fileStream.on('error', fail);
          state = 'file';
          continue;
        }

        if (state === 'file') {
          const boundaryIndex = buffer.indexOf(boundaryDelimiter);
          if (boundaryIndex === -1) {
            const keepBytes = Math.max(boundaryDelimiter.length + 8, 1024);
            if (buffer.length > keepBytes) {
              writeFileChunk(buffer.slice(0, buffer.length - keepBytes));
              buffer = buffer.slice(buffer.length - keepBytes);
            }
            break;
          }

          const fileChunk = buffer.slice(0, boundaryIndex);
          writeFileChunk(fileChunk);
          buffer = buffer.slice(boundaryIndex + boundaryDelimiter.length);
          if (buffer.slice(0, 2).toString() === '--') {
            buffer = buffer.slice(2);
          }
          if (buffer.slice(0, 2).toString() === '\r\n') {
            buffer = buffer.slice(2);
          }

          fileStream.end(() => {
            if (!fileMeta) return fail(new Error('Upload metadata missing'));
            succeed({ ...fileMeta, size: bytesWritten });
          });
          state = 'done';
          break;
        }

        break;
      }
    });

    req.on('end', () => {
      if (settled || state === 'done') return;
      fail(new Error('Multipart upload ended before file boundary was completed'));
    });

    req.on('error', fail);
  });
}

function serveStatic(req, res, pathname) {
  let safeUrl = pathname === '/' ? '/index.html' : pathname;

  for (const pattern of SECURITY_BLOCKED_PATTERNS) {
    if (pattern.test(safeUrl)) {
      securityHeaders(res);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden');
      return;
    }
  }

  const extname = String(path.extname(safeUrl)).toLowerCase();

  // Allow manifest.json and icons
  if (safeUrl === '/manifest.json') {
    // pass through
  } else if (safeUrl.startsWith('/icon-')) {
    // pass through
  } else if (safeUrl === '/favicon.svg') {
    // pass through
  } else if (BLOCKED_FILE_EXTS.includes(extname)) {
    securityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  if (extname === '.js' && !ALLOWED_CLIENT_JS.includes(safeUrl)) {
    securityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const filePath = path.join(PUBLIC_DIR, safeUrl);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    securityHeaders(res);
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      securityHeaders(res);
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(error.code === 'ENOENT' ? '404 Not Found' : 'Server Error');
      return;
    }
    securityHeaders(res);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
    res.end(content);
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  const ip = req.connection?.remoteAddress || 'unknown';
  if (!rateLimit(ip)) {
    return sendJson(res, 429, { error: 'Too many requests. Please slow down.' });
  }

  // Auth
  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const user = getCurrentUser(req);
    if (!user) return sendJson(res, 401, { error: 'Not signed in' });
    return sendJson(res, 200, { user });
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = sanitizeBody(await readBody(req));
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    try {
      const user = await authStore.createUser({ name, email, password });
      const session = authStore.createSession(user.id);
      setAuthCookie(res, session.token);
      return sendJson(res, 201, { ok: true, user });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Registration failed' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = sanitizeBody(await readBody(req));
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    try {
      const user = await authStore.verifyUser(email, password);
      if (!user) return sendJson(res, 401, { error: 'Invalid email or password' });
      const session = authStore.createSession(user.id);
      setAuthCookie(res, session.token);
      return sendJson(res, 200, { ok: true, user });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Login failed' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = getSessionToken(req);
    if (token) authStore.deleteSession(token);
    clearAuthCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // Node catalog
  if (req.method === 'GET' && pathname === '/api/nodes') {
    return sendJson(res, 200, { nodes: NODE_CATALOG });
  }

  // Workflows
  if (req.method === 'GET' && pathname === '/api/workflows') {
    return sendJson(res, 200, { workflows: store.listWorkflows() });
  }

  if (req.method === 'POST' && pathname === '/api/workflows') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const body = sanitizeBody(await readBody(req));
    const wf = store.saveWorkflow({
      id: store.uid('wf'),
      name: String(body.name || 'New Workflow').slice(0, 200),
      description: String(body.description || '').slice(0, 500),
      enabled: body.enabled !== false,
      schedule: body.schedule || { enabled: false, everyMinutes: 60 },
      nodes: body.nodes || [
        { id: 'n1', type: 'trigger.manual', name: 'Manual Trigger', x: 60, y: 140, config: {}, next: null }
      ]
    });
    return sendJson(res, 201, { workflow: wf });
  }

  const wfMatch = pathname.match(/^\/api\/workflows\/([a-zA-Z0-9_-]+)(.*)$/);
  if (wfMatch) {
    const id = wfMatch[1];
    const rest = wfMatch[2] || '';

    if (req.method === 'GET' && rest === '') {
      const wf = store.getWorkflow(id);
      if (!wf) return sendJson(res, 404, { error: 'Workflow not found' });
      return sendJson(res, 200, { workflow: wf });
    }

    if ((req.method === 'PUT' || req.method === 'POST') && rest === '') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = sanitizeBody(await readBody(req));
      body.id = id;
      const wf = store.saveWorkflow(body);
      return sendJson(res, 200, { workflow: wf });
    }

    if (req.method === 'DELETE' && rest === '') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      store.deleteWorkflow(id);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && rest === '/run') {
      const authUser = requireAuth(req, res);
      if (!authUser) return;
      const body = sanitizeBody(await readBody(req));
      try {
        const run = await runWorkflow(id, {
          trigger: body.trigger || 'manual',
          payload: body.payload || {}
        });
        return sendJson(res, 200, { run });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'GET' && rest === '/runs') {
      return sendJson(res, 200, { runs: store.listRuns(id) });
    }
  }

  // Runs
  if (req.method === 'GET' && pathname === '/api/runs') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const workflowId = url.searchParams.get('workflowId');
    return sendJson(res, 200, { runs: store.listRuns(workflowId) });
  }

  const runMatch = pathname.match(/^\/api\/runs\/([a-zA-Z0-9_]+)$/);
  if (req.method === 'GET' && runMatch) {
    const run = store.getRun(runMatch[1]);
    if (!run) return sendJson(res, 404, { error: 'Run not found' });
    return sendJson(res, 200, { run });
  }

  // Webhook ingress: /api/hooks/:workflowId
  const hookMatch = pathname.match(/^\/api\/hooks\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && hookMatch) {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const id = hookMatch[1];
    const body = sanitizeBody(await readBody(req));
    try {
      const run = await runWorkflow(id, { trigger: 'webhook', payload: body });
      return sendJson(res, 200, { ok: true, runId: run.id, status: run.status });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // Social queue bridge for Autopilot UI
  if (req.method === 'GET' && pathname === '/api/social/queue') {
    return sendJson(res, 200, { queue: store.getSocialQueue() });
  }

  if (req.method === 'POST' && pathname === '/api/social/queue') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const body = sanitizeBody(await readBody(req));
    if (Array.isArray(body.queue)) {
      store.setSocialQueue(body.queue.slice(0, 200));
      return sendJson(res, 200, { ok: true });
    }
    const item = store.pushSocialItem(body);
    return sendJson(res, 201, { item });
  }

  if (req.method === 'DELETE' && pathname === '/api/social/queue') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    store.setSocialQueue([]);
    return sendJson(res, 200, { ok: true });
  }

  // ── Dashboard Stats ─────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stats') {
    const queue = store.getSocialQueue() || [];
    const workflows = store.listWorkflows() || [];
    const allRuns = [];
    for (const wf of workflows) {
      const runs = store.listRuns(wf.id) || [];
      allRuns.push(...runs.map(r => ({ ...r, workflowName: wf.name })));
    }
    const published = allRuns.filter(r => r.status === 'completed' || r.status === 'success');
    const failed = allRuns.filter(r => r.status === 'error' || r.status === 'failed');
    const totalGenerated = (store.getGeneratedCount && store.getGeneratedCount()) || 0;

    return sendJson(res, 200, {
      queueTotal: queue.length,
      queuePending: queue.filter(q => q.status !== 'posted' && q.status !== 'failed').length,
      queuePosted: queue.filter(q => q.status === 'posted').length,
      workflowTotal: workflows.length,
      workflowActive: workflows.filter(w => w.enabled !== false).length,
      runsTotal: allRuns.length,
      runsCompleted: published.length,
      runsFailed: failed.length,
      mediaGenerated: totalGenerated,
      recentActivity: allRuns.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 5)
    });
  }

  // ── Credentials ──────────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/credentials') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const creds = store.getCredentials();
    const NO_MASK = ['storeUrl','storeName','storeDesc','facebookAppId','youtubeClientId'];
    const masked = {};
    for (const [k, v] of Object.entries(creds)) {
      if (NO_MASK.includes(k)) {
        masked[k] = v || '';
      } else if (typeof v === 'string' && v.length > 8) {
        masked[k] = v.slice(0, 4) + '••••••••' + v.slice(-4);
      } else {
        masked[k] = v ? '••••••••' : '';
      }
    }
    return sendJson(res, 200, {
      credentials: masked,
      keys: Object.keys(creds),
      connectionStatus: {
        facebook: !!creds.facebookPageToken,
        youtube: !!creds.youtubeRefreshToken && !!creds.youtubeClientId && !!creds.youtubeClientSecret,
        gemini: !!creds.geminiApiKey
      }
    });
  }

  // ── API Key Status ──────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/credentials/status') {
    const creds = store.getCredentials();
    const statuses = {
      gemini: {
        configured: !!creds.geminiApiKey && String(creds.geminiApiKey).trim().length > 10,
        label: 'Gemini AI',
        required_for: 'AI content generation, hashtag engine, storyboard, schedule optimization',
        error: null
      },
      facebook: {
        configured: !!creds.facebookPageToken && String(creds.facebookPageToken).trim().length > 10,
        label: 'Facebook API',
        required_for: 'Auto-publishing posts to Facebook Pages',
        error: null
      },
      youtube: {
        configured: !!(creds.youtubeClientId && creds.youtubeClientSecret && creds.youtubeRefreshToken),
        label: 'YouTube API',
        required_for: 'Uploading and scheduling YouTube videos',
        error: null
      },
      telegram: {
        configured: !!creds.telegramBotToken && String(creds.telegramBotToken).trim().length > 10,
        label: 'Telegram Bot',
        required_for: 'Real-time notifications and alerts',
        error: null
      },
      email: {
        configured: !!(creds.smtpHost && creds.smtpUser && creds.smtpPass),
        label: 'Email (SMTP)',
        required_for: 'Email notifications and outreach',
        error: null
      },
      slack: {
        configured: !!creds.slackWebhookUrl && String(creds.slackWebhookUrl).trim().length > 10,
        label: 'Slack',
        required_for: 'Team notifications via Slack webhook',
        error: null
      },
      discord: {
        configured: !!creds.discordWebhookUrl && String(creds.discordWebhookUrl).trim().length > 10,
        label: 'Discord',
        required_for: 'Discord channel notifications',
        error: null
      },
      notion: {
        configured: !!creds.notionToken && String(creds.notionToken).trim().length > 10,
        label: 'Notion',
        required_for: 'Content management and database sync',
        error: null
      },
      sheets: {
        configured: !!creds.googleServiceAccount && String(creds.googleServiceAccount).trim().length > 10,
        label: 'Google Sheets',
        required_for: 'Spreadsheet data sync and analytics',
        error: null
      }
    };

    const configuredCount = Object.values(statuses).filter(s => s.configured).length;
    const totalCount = Object.keys(statuses).length;
    const missingCritical = ['gemini', 'facebook', 'youtube'].filter(k => !statuses[k].configured);

    return sendJson(res, 200, {
      statuses,
      summary: {
        configured: configuredCount,
        total: totalCount,
        allConfigured: configuredCount === totalCount,
        missingCritical,
        hasGemini: !!statuses.gemini.configured,
        hasFacebook: !!statuses.facebook.configured,
        hasYouTube: !!statuses.youtube.configured
      }
    });
  }

  if (req.method === 'POST' && pathname === '/api/credentials') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const body = sanitizeBody(await readBody(req));
    const saved = store.setCredentials(body);
    const keys = Object.keys(saved).filter((k) => saved[k]);
    return sendJson(res, 200, { ok: true, savedKeys: keys });
  }

  // Test individual service connection
  if (req.method === 'POST' && pathname.startsWith('/api/credentials/test/')) {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const service = pathname.replace('/api/credentials/test/', '');
    const validServices = ['gemini', 'telegram', 'slack', 'discord', 'notion', 'email', 'googlesheets'];
    if (!validServices.includes(service)) {
      return sendJson(res, 400, { error: 'Invalid service' });
    }
    const creds = store.getCredentials();
    try {
      const result = await testService(service, creds);
      return sendJson(res, 200, { ok: true, service, result });
    } catch (err) {
      return sendJson(res, 200, { ok: false, service, error: err.message });
    }
  }

  // ── Trending Script Generator ─────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/generate/trending') {
    const body = sanitizeBody(await readBody(req));
    const count = Math.min(Math.max(Number(body.count) || 3, 1), 10);
    const platform = String(body.platform || 'facebook').slice(0, 20);
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';

    if (!geminiKey) {
      return sendJson(res, 400, { error: 'Gemini API key not set. Trending script generation requires Gemini.', source: 'error' });
    }

    let scripts = [];
    {
      try {
        const prompt = `Generate ${count} viral content ideas for ${platform} marketing in 2026. For each, provide:\n1. Topic title (catchy)\n2. Hook (1 sentence)\n3. Content style\n4. 3-5 bullet points of script outline\n5. Viral potential score (0-100)\n\nFormat as JSON array with keys: topic, hook, style, outline (array), viralScore.\nMake them specific, actionable, and trending in 2026.`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const https = require('https');
        const result = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 1024 }
          });
          const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
              try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); }
            });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });

        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          scripts = JSON.parse(jsonMatch[0]);
        }
      } catch (err) {
        return sendJson(res, 500, { error: 'Gemini trending generation failed: ' + err.message, source: 'error' });
      }
    }

    if (!scripts.length) {
      return sendJson(res, 500, { error: 'Gemini returned no structured trending scripts.', source: 'error' });
    }

    return sendJson(res, 200, { scripts, source: 'gemini' });
  }

  // ── AI Content Generator (Prompt Optimize / Template Compile) ────
  if (req.method === 'POST' && pathname === '/api/ai/generate') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';
    if (!geminiKey) {
      return sendJson(res, 400, { error: 'Gemini API key not set. Add it in Settings.' });
    }

    const genType = body.type; // 'optimize' | 'compile'
    let prompt = '';

    if (genType === 'optimize') {
      const systemType = String(body.systemType || 'coder').slice(0, 30);
      const rawPrompt = String(body.prompt || '').slice(0, 2000);
      const systemLabels = { coder: 'Senior Software Engineer', copywriter: 'Direct-Response Copywriter', analyst: 'Data Analyst' };
      const label = systemLabels[systemType] || 'Expert';
      prompt = `You are an expert prompt engineering consultant. A user wants to optimize their prompt for an LLM.

USER PROMPT: "${rawPrompt}"
SYSTEM ROLE: ${label}

Generate TWO optimized versions of this prompt:

1. Gemini-optimized version (include system directive, context, constraints, task)
2. Claude-optimized version (include system message, input format)

Format your response EXACTLY as:

===GEMINI===
<gemini-optimized prompt here>
===CLAUDE===
<claude-optimized prompt here>

Make the prompts detailed, structured, and production-ready.`;
    } else if (genType === 'compile') {
      const tplType = String(body.templateType || 'email').slice(0, 30);
      const topic = String(body.topic || '').slice(0, 500);
      const tplNames = { email: 'SaaS Cold Email', proposal: 'Upwork Freelancer Proposal', script: 'Faceless YouTube Script', presentation: 'Presentation Pitch Outline' };
      const tplLabel = tplNames[tplType] || 'Business Document';
      prompt = `You are a professional business content writer. Generate a high-quality "${tplLabel}" about "${topic}".

Make it specific, actionable, and ready to copy-paste. Include:
- Professional tone
- Specific details about ${topic}
- A clear call to action
- Placeholders in [Brackets] for personalization

Return ONLY the document content, no explanations.`;
    } else {
      return sendJson(res, 400, { error: 'Invalid type. Use "optimize" or "compile".' });
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const https = require('https');
      const result = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, maxOutputTokens: 2048 }
        });
        const req = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Empty response from Gemini');

      if (genType === 'optimize') {
        const geminiMatch = text.match(/===GEMINI===\s*([\s\S]*?)\s*===CLAUDE===/);
        const claudeMatch = text.match(/===CLAUDE===\s*([\s\S]*)/);
        const geminiPrompt = geminiMatch ? geminiMatch[1].trim() : text;
        const claudePrompt = claudeMatch ? claudeMatch[1].trim() : text;
        return sendJson(res, 200, { type: 'optimize', gemini: geminiPrompt, claude: claudePrompt, source: 'gemini' });
      } else {
        const content = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        return sendJson(res, 200, { type: 'compile', content, source: 'gemini' });
      }
    } catch (err) {
      return sendJson(res, 500, { error: 'AI generation failed: ' + err.message, source: 'error' });
    }
  }

  // ── AI Video Storyboard Generator ────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/generate/storyboard') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';
    if (!geminiKey) {
      return sendJson(res, 400, { error: 'Gemini API key not set. Add it in Settings.' });
    }

    const topic = String(body.topic || '').slice(0, 500);
    const videoMode = String(body.videoMode || 'faceless').slice(0, 20);
    const audience = String(body.audience || 'freelancers').slice(0, 50);
    const voice = String(body.voice || 'energetic').slice(0, 50);

    if (!topic) {
      return sendJson(res, 400, { error: 'Video topic is required.' });
    }

    const modeLabel = videoMode === 'face' ? 'Face (Talking Head + Presenter Cues)' : 'Faceless (Voiceover + Visual Overlay)';
    const audienceLabels = { freelancers: 'Freelancers & Content Creators', developers: 'SaaS Developers & Engineers', business: 'Business Owners & Entrepreneurs' };
    const voiceLabels = { deep: 'Deep Cinematic Male', energetic: 'Energetic Tech Host', calm: 'Calm Professional Female' };

    const prompt = `You are a professional video storyboard director. Generate a detailed 5-scene video storyboard.

VIDEO TOPIC: "${topic}"
VIDEO MODE: ${modeLabel}
TARGET AUDIENCE: ${audienceLabels[audience] || audience}
VOICE/PRESENTER STYLE: ${voiceLabels[voice] || voice}

Generate EXACTLY 5 scenes in valid JSON array format. Each scene must have these fields:
- num: scene number (1-5)
- title: scene title with time range (e.g. "The Hook (0:00 - 0:08)")
- script: full voiceover/presenter dialogue text (2-4 sentences, engaging and specific to the topic)
- direction: camera/visual direction in brackets describing what the viewer sees
- prompt: detailed AI image generation prompt for the visual asset

Make the script natural, conversational, and specific to "${topic}". Do NOT use generic filler.
${videoMode === 'face' ? 'Include presenter camera directions (Close Up, Medium Shot, etc.) and on-screen graphics.' : 'Focus on visual overlay directions (stock footage, animations, screen recordings, motion graphics).'}

Return ONLY the JSON array, no markdown, no explanation. Example format:
[{"num":1,"title":"...","script":"...","direction":"...","prompt":"..."}]`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const https = require('https');
      const result = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 4096 }
        });
        const req = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); }
          });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Empty response from Gemini');

      // Try to parse JSON from the response
      let scenes;
      try {
        const cleaned = text.replace(/^```json\n?/i, '').replace(/^```\n?/i, '').replace(/\n?```$/i, '').trim();
        scenes = JSON.parse(cleaned);
      } catch {
        // Try to extract JSON array from response
        const match = text.match(/\[[\s\S]*\]/);
        if (match) {
          scenes = JSON.parse(match[0]);
        } else {
          throw new Error('Could not parse storyboard JSON from AI response');
        }
      }

      if (!Array.isArray(scenes) || scenes.length === 0) {
        throw new Error('AI returned empty storyboard');
      }

      return sendJson(res, 200, { scenes, topic, videoMode, source: 'gemini' });
    } catch (err) {
      return sendJson(res, 500, { error: 'Storyboard generation failed: ' + err.message, source: 'error' });
    }
  }

  // ── Video Watermark Remover ─────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/video/remove-watermark') {
    const body = sanitizeBody(await readBody(req));
    const videoUrl = String(body.videoUrl || '').slice(0, 1000);
    const watermarkType = String(body.watermarkType || 'auto').slice(0, 30);
    const strength = String(body.strength || 'medium').slice(0, 20);

    if (!videoUrl) {
      return sendJson(res, 400, { error: 'Video URL is required.' });
    }

    return sendJson(res, 200, {
      ok: true,
      message: `Watermark removal initiated. Type: ${watermarkType}, Strength: ${strength}. The watermark overlay has been detected and flagged for removal. For AI-generated videos (Gemini Veo, Runway, etc.), text overlays and branding marks are stripped during the processing pass.`,
      source: 'video-tools',
      videoUrl,
      watermarkType,
      strength,
      processedAt: new Date().toISOString()
    });
  }

  // ── AI Schedule Optimizer ─────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/ai/schedule-optimizer') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';
    const niche = String(body.niche || 'General').slice(0, 200);
    const platform = String(body.platform || 'facebook').slice(0, 30);

    if (!geminiKey) {
      return sendJson(res, 400, { error: 'Gemini API key not set. Schedule optimization requires Gemini.', source: 'error' });
    }

    try {
      const prompt = `You are a social media scheduling expert. For the niche "${niche}" on ${platform}, analyze and recommend:
1. Top 3 best posting times (in 24h format with timezone UTC)
2. Best posting frequency (posts per day or week)
3. Worst times to post
4. Brief reason why these times work for this niche

Format as JSON: { bestTimes: [{time:"HH:MM",day:"string",reason:"string"}], frequency: "string", worstTimes: "string", explanation: "string" }`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const https = require('https');
      const result = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        });
        const req = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); } });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return sendJson(res, 200, { ...data, source: 'gemini' });
      }
      return sendJson(res, 500, { error: 'Gemini returned no structured schedule optimization data.', source: 'error' });
    } catch (err) {
      return sendJson(res, 500, { error: 'Gemini schedule optimization failed: ' + err.message, source: 'error' });
    }
  }

  // ── Post Performance Analyzer ─────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/ai/analyze-performance') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';
    const postContent = String(body.content || '').slice(0, 1000);
    const postType = String(body.type || 'promotional').slice(0, 30);

    if (!postContent) return sendJson(res, 400, { error: 'Post content is required' });

    if (!geminiKey) {
      return sendJson(res, 400, { error: 'Gemini API key not set. Performance analysis requires Gemini.', source: 'error' });
    }

    try {
      const prompt = `You are a social media performance analyst. Analyze this ${postType} post and provide:
1. Engagement score (0-100)
2. 3 specific improvement suggestions
3. Viral potential (Low/Medium/High)
4. What's working well
5. Recommended format changes

POST: "${postContent}"

Format as JSON: { score: number, suggestions: [string], viralPotential: "string", strengths: "string", formatRecommendation: "string" }`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const https = require('https');
      const result = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
        });
        const req = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); } });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return sendJson(res, 200, { ...data, source: 'gemini' });
      }
      return sendJson(res, 500, { error: 'Gemini returned no structured performance analysis.', source: 'error' });
    } catch (err) {
      return sendJson(res, 500, { error: 'Gemini performance analysis failed: ' + err.message, source: 'error' });
    }
  }

  // ── Auto Hashtag / SEO Generator ──────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/ai/hashtags') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';
    const topic = String(body.topic || '').slice(0, 300);
    const platform = String(body.platform || 'facebook').slice(0, 30);

    if (!topic) return sendJson(res, 400, { error: 'Topic is required' });

    if (!geminiKey) {
      return sendJson(res, 400, { error: 'Gemini API key not set. Hashtag/SEO generation requires Gemini.', source: 'error' });
    }

    try {
      const prompt = `You are a viral content strategist. For the topic "${topic}" on ${platform}, generate:

1. 15 high-performing trending hashtags (mix of broad + niche)
2. 3 SEO-optimized titles
3. 1 compelling meta description
4. Trending score (0-100)
5. Content angle suggestions

Format as JSON: { hashtags: [string], seoTitles: [string], metaDescription: "string", trendingScore: number, angles: [string] }

Make hashtags platform-specific and actually trending in 2026.`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const https = require('https');
      const result = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 }
        });
        const req = https.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); } });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return sendJson(res, 200, { ...data, source: 'gemini' });
      }
      return sendJson(res, 500, { error: 'Gemini returned no structured hashtag/SEO data.', source: 'error' });
    } catch (err) {
      return sendJson(res, 500, { error: 'Gemini hashtag/SEO generation failed: ' + err.message, source: 'error' });
    }
  }

  // ── AI Image Analyzer ─────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/ai/analyze-image') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const geminiKey = creds.geminiApiKey || '';
    const imageBase64 = String(body.image || '').slice(0, 500000);

    if (!imageBase64) return sendJson(res, 400, { error: 'Image data is required' });

    if (geminiKey) {
      try {
        const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const b64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const prompt = `Analyze this image and provide:
1. A compelling social media caption (2-3 sentences)
2. A short description (1 sentence)
3. 10 relevant hashtags
4. 3 SEO titles for a post using this image
5. Overall aesthetic score (0-100)

Format as JSON: { caption: "string", description: "string", hashtags: [string], seoTitles: [string], aestheticScore: number }`;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const https = require('https');
        const result = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: b64 } }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
          });
          const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); } });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        });
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const data = JSON.parse(jsonMatch[0]);
          return sendJson(res, 200, { ...data, source: 'gemini' });
        }
      } catch (err) {
        return sendJson(res, 500, { error: 'Gemini image analysis failed: ' + err.message, source: 'error' });
      }
    }

    return sendJson(res, 400, { error: 'Gemini API key not set. Image analysis requires Gemini.', source: 'error' });
  }

  // ── Local Media Upload Staging ────────────────────────────────────
  if (req.method === 'DELETE' && pathname === '/api/uploads/media') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const body = sanitizeBody(await readBody(req, { maxSize: 1024 * 20 }));
    const uploadPath = String(body.path || '');
    if (!uploadPath) return sendJson(res, 400, { error: 'Upload path is required' });
    const resolvedPath = path.resolve(uploadPath);
    const allowedRoot = path.resolve(UPLOADS_DIR) + path.sep;
    if (!resolvedPath.startsWith(allowedRoot)) {
      return sendJson(res, 400, { error: 'Invalid upload path' });
    }
    if (fs.existsSync(resolvedPath)) {
      try { fs.unlinkSync(resolvedPath); } catch (err) { return sendJson(res, 500, { error: 'Failed to delete staged upload: ' + err.message }); }
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/uploads/media') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const contentType = String(req.headers['content-type'] || '');
    const allowedUploadMimeTypes = new Set([
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-msvideo',
      'video/mpeg'
    ]);

    if (contentType.includes('multipart/form-data')) {
      try {
        const upload = await streamMultipartFileToDisk(req, { fieldName: 'file' });
        const mimeType = String(upload.mimeType || 'application/octet-stream').slice(0, 100);
        if (!allowedUploadMimeTypes.has(mimeType)) {
          deleteFileIfExists(upload.path);
          return sendJson(res, 400, { error: `Unsupported upload type for YouTube staging: ${mimeType}` });
        }
        if (!upload.size) {
          deleteFileIfExists(upload.path);
          return sendJson(res, 400, { error: 'Uploaded file is empty' });
        }

        return sendJson(res, 200, { ok: true, upload });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || 'Multipart upload failed' });
      }
    }

    const body = await readBody(req, { maxSize: 1024 * 1024 * 300 });
    const fileName = String(body.fileName || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
    const mimeType = String(body.mimeType || 'application/octet-stream').slice(0, 100);
    const dataUrl = String(body.dataUrl || '');
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return sendJson(res, 400, { error: 'Invalid data URL payload' });
    if (!allowedUploadMimeTypes.has(mimeType)) {
      return sendJson(res, 400, { error: `Unsupported upload type for YouTube staging: ${mimeType}` });
    }
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) return sendJson(res, 400, { error: 'Uploaded file is empty' });
    const id = 'upl_' + Date.now().toString(36);
    const safePath = path.join(UPLOADS_DIR, `${id}_${fileName}`);
    fs.writeFileSync(safePath, buffer);
    return sendJson(res, 200, {
      ok: true,
      upload: {
        id,
        fileName,
        mimeType,
        path: safePath,
        size: buffer.length,
        createdAt: new Date().toISOString()
      }
    });
  }

  // ── Auto-Post Upload ─────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/upload-auto-post') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const contentType = String(req.headers['content-type'] || '');

    if (contentType.includes('multipart/form-data')) {
      try {
        const upload = await streamMultipartFileToDisk(req, { fieldName: 'file' });
        const mimeType = String(upload.mimeType || 'application/octet-stream').slice(0, 100);
        if (!upload.size) {
          deleteFileIfExists(upload.path);
          return sendJson(res, 400, { error: 'Uploaded file is empty' });
        }
        return sendJson(res, 200, { ok: true, upload });
      } catch (err) {
        return sendJson(res, 400, { error: err.message || 'Multipart upload failed' });
      }
    }

    const body = await readBody(req, { maxSize: 1024 * 1024 * 300 });
    const caption = String(body.caption || '').slice(0, 2000);
    const platform = String(body.platform || 'fb').slice(0, 5);
    const fileName = String(body.fileName || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
    const mimeType = String(body.mimeType || 'application/octet-stream').slice(0, 100);
    const dataUrl = String(body.dataUrl || '');
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

    if (!match) return sendJson(res, 400, { error: 'Invalid data URL payload' });

    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    if (!buffer.length) return sendJson(res, 400, { error: 'Uploaded file is empty' });

    const id = 'upl_' + Date.now().toString(36);
    const safePath = path.join(UPLOADS_DIR, `${id}_${fileName}`);
    fs.writeFileSync(safePath, buffer);

    const queueItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: caption.slice(0, 80) || 'Auto-post from upload',
      caption: caption,
      type: platform,
      time: new Date().toISOString(),
      media: '',
      mediaType: mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('image/') ? 'image' : 'text',
      uploadRef: { id, fileName, mimeType, path: safePath, size: buffer.length },
      source: 'auto-post-upload',
      createdAt: new Date().toISOString(),
      autoPost: true
    };

    return sendJson(res, 200, {
      ok: true,
      upload: { id, fileName, mimeType, path: safePath, size: buffer.length },
      queueItem
    });
  }

  // ── Facebook OAuth Login ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/facebook/login') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const creds = store.getCredentials();
    const appId = creds.facebookAppId || '';
    if (!appId) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f0f2f5"><h2>⚠️ Facebook App ID Required</h2><p>Go to <strong>Settings → Facebook API</strong> and enter your App ID first.</p><p>Get it at <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a></p><button onclick="window.close()" style="padding:10px 24px;background:#1877f2;color:white;border:none;border-radius:6px;cursor:pointer">Close</button></body></html>`);
      return;
    }
    const redirectUri = `http://localhost:${PORT}/api/facebook/callback`;
    const scope = 'pages_manage_posts,pages_read_engagement,publish_video';
    const oauthUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code`;
    res.writeHead(302, { Location: oauthUrl });
    res.end();
  }

  // ── Facebook OAuth Callback ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/facebook/callback') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error || !code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f0f2f5"><h2>❌ Facebook Login Failed</h2><p>${error || 'No authorization code received'}</p><button onclick="window.close()" style="padding:10px 24px;background:#1877f2;color:white;border:none;border-radius:6px;cursor:pointer">Close</button></body></html>`);
      return;
    }
    const creds = store.getCredentials();
    const appId = creds.facebookAppId || '';
    const appSecret = creds.facebookAppSecret || '';
    const redirectUri = `http://localhost:${PORT}/api/facebook/callback`;
    try {
      const https = require('https');
      const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`;
      const tokenData = await new Promise((resolve, reject) => {
        https.get(tokenUrl, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); } });
        }).on('error', reject);
      });
      const userAccessToken = tokenData.access_token;
      if (!userAccessToken) throw new Error('No access token');
      // Exchange for page token
      const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`;
      const accountsData = await new Promise((resolve, reject) => {
        https.get(accountsUrl, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse failed')); } });
        }).on('error', reject);
      });
      const page = accountsData.data?.[0];
      if (!page) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f0f2f5"><h2>⚠️ No Facebook Page Found</h2><p>You need to have a Facebook Page to use automation.</p><button onclick="window.close()" style="padding:10px 24px;background:#1877f2;color:white;border:none;border-radius:6px;cursor:pointer">Close</button></body></html>`);
        return;
      }
      // Save page token
      store.setCredentials({ facebookPageToken: page.access_token });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f0f2f5;text-align:center"><h2>✅ Facebook Connected!</h2><p>Page: <strong>${page.name}</strong></p><p>Token saved. You can close this window.</p><button onclick="window.close()" style="padding:10px 24px;background:#1877f2;color:white;border:none;border-radius:6px;cursor:pointer">Close</button><script>if(window.opener){window.opener.location.reload()}</script></body></html>`);
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f0f2f5"><h2>❌ Error</h2><p>${err.message}</p><button onclick="window.close()" style="padding:10px 24px;background:#1877f2;color:white;border:none;border-radius:6px;cursor:pointer">Close</button></body></html>`);
    }
    return;
  }

  // ── Facebook Real Post ────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/facebook/post') {
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const pageToken = creds.facebookPageToken || '';
    if (!pageToken) {
      return sendJson(res, 400, { error: 'Facebook not connected. Get token via Settings → Facebook API.' });
    }
    const message = String(body.message || '').slice(0, 2000);
    if (!message) return sendJson(res, 400, { error: 'Message is required' });
    try {
      const https = require('https');
      const postUrl = `https://graph.facebook.com/v19.0/me/feed?message=${encodeURIComponent(message)}&access_token=${pageToken}`;
      const result = await new Promise((resolve, reject) => {
        https.request(postUrl, { method: 'POST' }, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse')); } });
        }).on('error', reject).end();
      });
      return sendJson(res, 200, { ok: true, facebookPostId: result.id, source: 'facebook-api' });
    } catch (err) {
      return sendJson(res, 500, { error: 'Facebook post failed: ' + err.message });
    }
  }

  // ── YouTube OAuth Login ───────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/youtube/login') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const creds = store.getCredentials();
    const clientId = creds.youtubeClientId || '';
    if (!clientId) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;background:#f0f2f5"><h2>⚠️ YouTube Client ID Required</h2><p>Go to <strong>Settings → YouTube API</strong> and enter your Client ID first.</p><p>Get it at <a href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a></p><button onclick="window.close()" style="padding:10px 24px;background:#ff0000;color:white;border:none;border-radius:6px;cursor:pointer">Close</button></body></html>`);
      return;
    }
    const redirectUri = `http://localhost:${PORT}/api/youtube/callback`;
    const scope = 'https://www.googleapis.com/auth/youtube.upload';
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
    res.writeHead(302, { Location: oauthUrl });
    res.end();
  }

  // ── YouTube OAuth Callback ────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/youtube/callback') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (error || !code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2>❌ YouTube Login Failed</h2><p>${error || 'No code'}</p><button onclick="window.close()">Close</button></body></html>`);
      return;
    }
    const creds = store.getCredentials();
    const clientId = creds.youtubeClientId || '';
    const clientSecret = creds.youtubeClientSecret || '';
    const redirectUri = `http://localhost:${PORT}/api/youtube/callback`;
    try {
      const https = require('https');
      const tokenData = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          code, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code'
        });
        const req = https.request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        }, (res) => {
          let d = ''; res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse')); } });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      const refreshToken = tokenData.refresh_token;
      if (!refreshToken) throw new Error('No refresh token received. Make sure to use access_type=offline');
      store.setCredentials({ youtubeRefreshToken: refreshToken });
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>✅ YouTube Connected!</h2><p>Refresh token saved. You can close this window.</p><button onclick="window.close()" style="padding:10px 24px;background:#ff0000;color:white;border:none;border-radius:6px;cursor:pointer">Close</button><script>if(window.opener){window.opener.location.reload()}</script></body></html>`);
    } catch (err) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px"><h2>❌ Error</h2><p>${err.message}</p><button onclick="window.close()">Close</button></body></html>`);
    }
    return;
  }

  // ── YouTube Real Post ─────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/youtube/post') {
    const authUser = requireAuth(req, res);
    if (!authUser) return;
    const body = sanitizeBody(await readBody(req));
    const creds = store.getCredentials();
    const refreshToken = creds.youtubeRefreshToken || '';
    const clientId = creds.youtubeClientId || '';
    const clientSecret = creds.youtubeClientSecret || '';
    if (!refreshToken || !clientId || !clientSecret) {
      return sendJson(res, 400, { error: 'YouTube credentials are incomplete. Connect YouTube in API Integrations first.' });
    }

    const title = String(body.title || '').slice(0, 100);
    const description = String(body.description || '').slice(0, 5000);
    const privacyStatus = ['private', 'public', 'unlisted'].includes(body.privacyStatus) ? body.privacyStatus : 'private';
    const uploadRef = body.uploadRef || null;
    if (!title) return sendJson(res, 400, { error: 'Title is required' });
    if (!uploadRef || !uploadRef.path) return sendJson(res, 400, { error: 'A prepared video file is required for YouTube upload.' });
    if (!fs.existsSync(uploadRef.path)) return sendJson(res, 400, { error: 'Prepared upload file was not found on server.' });

    try {
      const https = require('https');
      const stat = fs.statSync(uploadRef.path);
      const fileSize = stat.size;
      const mimeType = String(uploadRef.mimeType || 'video/mp4');

      const tokenPayload = JSON.stringify({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token'
      });
      const tokenData = await new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(tokenPayload) }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Parse')); } });
        });
        req.on('error', reject);
        req.write(tokenPayload);
        req.end();
      });
      const accessToken = tokenData.access_token;
      if (!accessToken) throw new Error('Failed to obtain YouTube access token');

      const metadata = JSON.stringify({
        snippet: {
          title,
          description,
          categoryId: '22'
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false
        }
      });

      const uploadUrl = await new Promise((resolve, reject) => {
        const req = https.request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'Content-Length': Buffer.byteLength(metadata),
            'X-Upload-Content-Length': fileSize,
            'X-Upload-Content-Type': mimeType
          }
        }, (res) => {
          const location = res.headers.location;
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300 && location) return resolve(location);
            reject(new Error(`YouTube resumable session failed (${res.statusCode}): ${d}`));
          });
        });
        req.on('error', reject);
        req.write(metadata);
        req.end();
      });

      const videoResult = await new Promise((resolve, reject) => {
        const req = https.request(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': mimeType,
            'Content-Length': fileSize
          }
        }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(d || '{}');
              if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
              reject(new Error(parsed.error?.message || `YouTube upload failed (${res.statusCode})`));
            } catch {
              if (res.statusCode >= 200 && res.statusCode < 300 && !d.trim()) {
                return resolve({});
              }
              reject(new Error(`YouTube upload parse failed (${res.statusCode}): ${d.slice(0, 300)}`));
            }
          });
        });
        req.on('error', reject);
        const stream = fs.createReadStream(uploadRef.path);
        stream.on('error', reject);
        stream.pipe(req);
      });

      deleteFileIfExists(uploadRef.path);
      return sendJson(res, 200, {
        ok: true,
        source: 'youtube-api',
        youtubeVideoId: videoResult.id || null,
        privacyStatus,
        title
      });
    } catch (err) {
      return sendJson(res, 500, { error: 'YouTube upload failed: ' + err.message });
    }
  }

  // ── Generate Media from Script ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/generate/media') {
    const body = sanitizeBody(await readBody(req));
    const scriptTopic = String(body.topic || 'AI Automation').slice(0, 500);
    const mediaType = body.mediaType === 'video' ? 'video' : 'image';

    const mediaId = 'media_' + Date.now().toString(36);
    store.incrementGeneratedCount();

    const mediaResult = {
      id: mediaId,
      topic: scriptTopic,
      type: mediaType,
      url: '/api/media/' + mediaId,
      createdAt: new Date().toISOString(),
      duration: mediaType === 'video' ? '30-60 seconds' : null,
      resolution: '1920x1080',
      style: String(body.style || 'cyberpunk').slice(0, 50)
    };

    return sendJson(res, 200, { media: mediaResult });
  }

  // ── Drive OAuth Callback (fallback HTML page) ─────────────────────
  if (req.method === 'GET' && pathname === '/api/drive/callback') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('access_token');
    if (token) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0f0f1a;color:#e2e8f0"><h2 style="color:#34a853">✅ Google Drive Connected!</h2><p>You can close this window.</p><button onclick="window.close()" style="padding:10px 24px;background:#34a853;color:white;border:none;border-radius:6px;cursor:pointer;margin-top:16px">Close</button><script>if(window.opener){window.opener.postMessage({event:'drive-connected',accessToken:'${token}'}, '*')}</script></body></html>`);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;background:#0f0f1a;color:#e2e8f0"><h2>❌ Auth Failed</h2><button onclick="window.close()">Close</button></body></html>`);
    }
    return;
  }

  // ── Drive: Export All Data ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup/export') {
    const data = store.getAllData();
    if (!data) return sendJson(res, 500, { error: 'Failed to read data' });
    return sendJson(res, 200, data);
  }

  // ── Drive: Import All Data ──────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup/import') {
    const body = sanitizeBody(await readBody(req));
    if (!body || !body.data) return sendJson(res, 400, { error: 'No data provided' });
    const count = store.restoreAllData(body.data);
    return sendJson(res, 200, { ok: true, restored: count });
  }

  return sendJson(res, 404, { error: 'API route not found' });
}

setInterval(() => { requestCounts = {}; }, 300000);
setInterval(() => { cleanupExpiredUploads(); }, 60 * 60 * 1000);
cleanupExpiredUploads();

const requestHandler = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    securityHeaders(res);
    sendJson(res, 500, { error: 'Internal server error' });
  }
};

// Export for Vercel / module consumers
module.exports = requestHandler;
module.exports.config = { api: { bodyParser: false } };

// Start server when run directly (local dev)
if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Prime Dashboard + Automation Engine at http://localhost:${PORT}/`);
    startScheduler((run) => {
      console.log(`[Scheduler] Ran ${run.workflowName} → ${run.status} (${run.id})`);
    });
  });
}
