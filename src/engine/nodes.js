const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { pushSocialItem, uid, getCredentials } = require('./store');

/* ─── helpers ────────────────────────────────────────────────────────────── */

function getByPath(obj, pathStr) {
  if (!pathStr) return undefined;
  const clean = String(pathStr).replace(/^\{\{|\}\}$/g, '').trim();
  return clean.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function interpolate(template, ctx) {
  if (template == null) return template;
  if (typeof template !== 'string') return template;
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expr) => {
    try {
      if (/^Number\(/.test(expr.trim())) {
        const inner = expr.trim().slice(7, -1).trim();
        const val = interpolate(`{{${inner}}}`, ctx);
        return Number(val);
      }
      const parts = expr.trim().split('||').map((p) => p.trim());
      for (const part of parts) {
        const lit = part.match(/^["'](.*)['"']$/);
        if (lit) return lit[1];
        const val = getByPath(ctx, part);
        if (val !== undefined && val !== null && val !== '') return val;
      }
      return '';
    } catch {
      return '';
    }
  });
}

function deepInterpolate(value, ctx) {
  if (typeof value === 'string') return interpolate(value, ctx);
  if (Array.isArray(value)) return value.map((v) => deepInterpolate(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepInterpolate(v, ctx);
    return out;
  }
  return value;
}

function compare(left, operator, right) {
  const lNum = Number(left);
  const rNum = Number(right);
  const bothNum = !Number.isNaN(lNum) && !Number.isNaN(rNum) && String(left).trim() !== '' && String(right).trim() !== '';

  switch (operator) {
    case 'eq':   return String(left) === String(right);
    case 'neq':  return String(left) !== String(right);
    case 'gt':   return bothNum ? lNum > rNum : String(left) > String(right);
    case 'gte':  return bothNum ? lNum >= rNum : String(left) >= String(right);
    case 'lt':   return bothNum ? lNum < rNum : String(left) < String(right);
    case 'lte':  return bothNum ? lNum <= rNum : String(left) <= String(right);
    case 'contains': return String(left).toLowerCase().includes(String(right).toLowerCase());
    case 'empty':    return left === undefined || left === null || String(left).trim() === '';
    case 'notEmpty': return !(left === undefined || left === null || String(left).trim() === '');
    default:         return Boolean(left);
  }
}

function httpRequest(url, method = 'POST', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
      const req = lib.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...headers
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            let parsed = data;
            try { parsed = JSON.parse(data); } catch {}
            resolve({ status: res.statusCode, body: parsed });
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/* ─── 1. GEMINI AI ───────────────────────────────────────────────────────── */

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const res = await httpRequest(url, 'POST', {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.85, maxOutputTokens: 512 }
  });
  if (res.status !== 200) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function buildGeminiPrompt(text, style) {
  const base = String(text || '').trim();
  switch (style) {
    case 'youtube':
      return `You are a viral YouTube content creator. Rewrite the following into an attention-grabbing YouTube video description with emojis, hooks, and a call-to-action. Keep it under 200 words.\n\nOriginal: "${base}"\n\nRewritten:`;
    case 'formal':
      return `You are a professional business copywriter. Rewrite the following in a formal, polished tone suitable for B2B communications. Keep it concise.\n\nOriginal: "${base}"\n\nRewritten:`;
    case 'viral':
      return `You are a viral social media expert. Rewrite the following to maximize engagement on Facebook/Instagram. Use hooks, emojis, and urgency. Max 150 words.\n\nOriginal: "${base}"\n\nRewritten:`;
    case 'professional':
      return `You are a senior marketing professional. Rewrite the following for a professional LinkedIn audience. Clear, insightful, value-driven.\n\nOriginal: "${base}"\n\nRewritten:`;
    default: // engaging
      return `You are a top-tier AI copywriter. Rewrite the following to be more engaging, compelling, and conversion-focused. Add a power hook and CTA.\n\nOriginal: "${base}"\n\nRewritten:`;
  }
}

/* ─── 2. NODEMAILER EMAIL ────────────────────────────────────────────────── */

async function sendEmail(creds, to, subject, body) {
  // Dynamic require so nodemailer is optional
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch {
    throw new Error('nodemailer not installed. Run: npm install nodemailer');
  }
  const transporter = nodemailer.createTransport({
    host: creds.smtpHost || 'smtp.gmail.com',
    port: Number(creds.smtpPort) || 587,
    secure: Number(creds.smtpPort) === 465,
    auth: { user: creds.smtpUser, pass: creds.smtpPass }
  });
  const info = await transporter.sendMail({
    from: `"Prime Automation" <${creds.smtpUser}>`,
    to, subject,
    text: body,
    html: `<div style="font-family:sans-serif;max-width:600px;">${body.replace(/\n/g, '<br>')}</div>`
  });
  return { messageId: info.messageId, accepted: info.accepted };
}

/* ─── 3. TELEGRAM ────────────────────────────────────────────────────────── */

async function sendTelegram(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await httpRequest(url, 'POST', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  });
  if (!res.body?.ok) throw new Error(`Telegram error: ${JSON.stringify(res.body)}`);
  return res.body;
}

/* ─── 4. GOOGLE SHEETS (Service Account via JWT) ─────────────────────────── */

function base64url(buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken(serviceAccountJson) {
  const sa = typeof serviceAccountJson === 'string' ? JSON.parse(serviceAccountJson) : serviceAccountJson;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const unsigned = `${header}.${claim}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const sig = base64url(sign.sign(sa.private_key));
  const jwt = `${unsigned}.${sig}`;

  const res = await httpRequest('https://oauth2.googleapis.com/token', 'POST',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  if (!res.body?.access_token) throw new Error(`Google auth failed: ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

async function appendGoogleSheet(serviceAccountJson, spreadsheetId, sheetName, values) {
  const token = await getGoogleAccessToken(serviceAccountJson);
  const range = encodeURIComponent(`${sheetName}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await httpRequest(url, 'POST',
    { values: [values] },
    { Authorization: `Bearer ${token}` }
  );
  if (res.status < 200 || res.status >= 300) throw new Error(`Sheets error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

/* ─── 5. SLACK ───────────────────────────────────────────────────────────── */

async function sendSlack(webhookUrl, text, blocks = null) {
  const payload = blocks ? { text, blocks } : { text };
  const res = await httpRequest(webhookUrl, 'POST', payload);
  if (res.status !== 200) throw new Error(`Slack error ${res.status}`);
  return { ok: true };
}

/* ─── NODE CATALOG ───────────────────────────────────────────────────────── */

const NODE_CATALOG = [
  // Triggers
  { type: 'trigger.manual',   label: 'Manual Trigger',       category: 'Trigger', color: '#10b981' },
  { type: 'trigger.webhook',  label: 'Webhook Trigger',       category: 'Trigger', color: '#10b981' },
  { type: 'trigger.schedule', label: 'Schedule Trigger',      category: 'Trigger', color: '#10b981' },
  // Flow
  { type: 'delay',            label: 'Delay',                 category: 'Flow',    color: '#f59e0b' },
  { type: 'filter',           label: 'Filter',                category: 'Flow',    color: '#f59e0b' },
  { type: 'condition',        label: 'IF Condition',          category: 'Flow',    color: '#f59e0b' },
  // Data
  { type: 'set',              label: 'Set Variables',         category: 'Data',    color: '#06b6d4' },
  { type: 'ai.rewrite',       label: 'AI Rewrite (Gemini)',   category: 'Data',    color: '#8b5cf6' },
  // Actions
  { type: 'http',             label: 'HTTP Request',          category: 'Action',  color: '#3b82f6' },
  { type: 'email',            label: 'Email (Real SMTP)',     category: 'Action',  color: '#ef4444' },
  { type: 'telegram',         label: 'Telegram Message',      category: 'Action',  color: '#26a5e4' },
  { type: 'slack',            label: 'Slack Message',         category: 'Action',  color: '#4a154b' },
  { type: 'discord',          label: 'Discord Webhook',       category: 'Action',  color: '#5865F2' },
  { type: 'notion',           label: 'Notion Page',           category: 'Action',  color: '#ffffff' },
  { type: 'googlesheets',     label: 'Google Sheets Row',     category: 'Action',  color: '#34a853' },
  // Social
  { type: 'social.facebook',  label: 'Facebook Autopilot',   category: 'Social',  color: '#1877F2' },
  { type: 'social.youtube',   label: 'YouTube Autopilot',    category: 'Social',  color: '#FF0000' },
  // Utility
  { type: 'log',              label: 'Log Message',           category: 'Utility', color: '#8e95a5' },
];

/* ─── DEFAULT CONFIGS ────────────────────────────────────────────────────── */

function defaultConfig(type) {
  switch (type) {
    case 'delay':        return { ms: 1000 };
    case 'filter':       return { field: 'email', operator: 'notEmpty', value: '' };
    case 'condition':    return { left: '{{score}}', operator: 'gte', right: '0.7' };
    case 'set':          return { assignments: { message: '{{payload.message || "Hello"}}' } };
    case 'ai.rewrite':   return { field: 'message', style: 'engaging' };
    case 'http':         return { url: 'https://httpbin.org/post', method: 'POST', body: {} };
    case 'email':        return { to: '{{email}}', subject: 'Prime Automation Alert', body: '{{message || email}}' };
    case 'telegram':     return { chatId: '', text: '🤖 Prime Alert: {{message || topic || email}}' };
    case 'slack':        return { text: '🚀 Prime Automation: {{message || topic || email}}' };
    case 'discord':      return { webhookUrl: '', content: 'Automation event: {{message || topic || email}}' };
    case 'notion':       return { token: '', databaseId: '', title: '{{name || "Lead"}}' };
    case 'googlesheets': return { spreadsheetId: '', sheetName: 'Sheet1', columns: '{{name}},{{email}},{{score}}' };
    case 'social.facebook':
    case 'social.youtube': return { title: '{{message || topic || "Scheduled post"}}' };
    case 'log':          return { message: 'Checkpoint reached' };
    default:             return {};
  }
}

function metaFor(type) {
  return NODE_CATALOG.find((n) => n.type === type) || { label: type, color: '#8e95a5', category: 'Other' };
}

/* ─── EXECUTE NODE ───────────────────────────────────────────────────────── */

async function executeNode(node, ctx, helpers) {
  const config = deepInterpolate(node.config || {}, ctx);
  const type = node.type;
  const creds = getCredentials();

  // ── Triggers ──────────────────────────────────────────────────────────────
  if (type.startsWith('trigger.')) {
    return { ok: true, output: { triggered: type, at: new Date().toISOString() }, next: node.next };
  }

  // ── Delay ─────────────────────────────────────────────────────────────────
  if (type === 'delay') {
    const ms = Math.min(Math.max(Number(config.ms) || 500, 0), 15000);
    await new Promise((r) => setTimeout(r, ms));
    return { ok: true, output: { delayedMs: ms }, next: node.next };
  }

  // ── Set Variables ─────────────────────────────────────────────────────────
  if (type === 'set') {
    const assignments = config.assignments || {};
    for (const [key, value] of Object.entries(assignments)) {
      ctx[key] = deepInterpolate(value, ctx);
    }
    return { ok: true, output: { set: Object.keys(assignments) }, next: node.next };
  }

  // ── AI Rewrite (Gemini) ───────────────────────────────────────────────────
  if (type === 'ai.rewrite') {
    const field = config.field || 'message';
    const current = getByPath(ctx, field) ?? ctx[field] ?? ctx.message ?? '';
    const style = config.style || 'engaging';

    const geminiKey = creds.geminiApiKey || config.apiKey || '';
    if (geminiKey) {
      try {
        const prompt = buildGeminiPrompt(current, style);
        const rewritten = await callGemini(prompt, geminiKey);
        ctx[field] = rewritten;
        ctx.rewritten = rewritten;
        helpers.log(`✅ Gemini AI rewrote "${field}" (${style} style)`);
        return { ok: true, output: { field, rewritten, live: true }, next: node.next };
      } catch (err) {
        helpers.log(`❌ Gemini error: ${err.message}`);
        return { ok: false, error: err.message, next: null };
      }
    }

    helpers.log('❌ Gemini API key missing — AI Rewrite node requires a real Gemini key in Settings.');
    return { ok: false, error: 'Gemini API key missing', next: null };
  }

  // ── Filter ────────────────────────────────────────────────────────────────
  if (type === 'filter') {
    const field = config.field || 'email';
    const left = getByPath(ctx, field) ?? ctx[field] ?? getByPath(ctx.payload || {}, field);
    const pass = compare(left, config.operator || 'notEmpty', config.value);
    if (!pass) {
      return { ok: true, output: { filtered: true, field, left }, next: null, stopped: true };
    }
    return { ok: true, output: { filtered: false, field, left }, next: node.next };
  }

  // ── Condition ─────────────────────────────────────────────────────────────
  if (type === 'condition') {
    const left = interpolate(String(config.left ?? ''), ctx);
    const right = interpolate(String(config.right ?? ''), ctx);
    const result = compare(left, config.operator || 'eq', right);
    return {
      ok: true,
      output: { left, right, operator: config.operator, result },
      next: result ? node.nextTrue : node.nextFalse
    };
  }

  // ── HTTP Request ──────────────────────────────────────────────────────────
  if (type === 'http') {
    if (!config.url) return { ok: false, error: 'HTTP node requires url', next: null };
    const res = await httpRequest(config.url, config.method || 'POST', config.body ?? ctx.payload, config.headers || {});
    ctx.httpResponse = res;
    return { ok: res.status >= 200 && res.status < 300, output: res, next: node.next };
  }

  // ── Email (Real SMTP via Nodemailer) ──────────────────────────────────────
  if (type === 'email') {
    const to      = config.to || creds.smtpUser || 'team@example.com';
    const subject = config.subject || 'Prime Automation Alert';
    const body    = config.body || ctx.message || '';

    if (creds.smtpUser && creds.smtpPass) {
      try {
        const info = await sendEmail(creds, to, subject, body);
        helpers.log(`✅ Email sent → ${to} (${info.messageId || 'ok'})`);
        return { ok: true, output: { to, subject, live: true, ...info }, next: node.next };
      } catch (err) {
        helpers.log(`❌ Email error: ${err.message}`);
        return { ok: false, error: err.message, next: null };
      }
    }

    helpers.log(`❌ SMTP credentials missing — cannot send email to ${to}. Configure SMTP in Settings.`);
    return { ok: false, error: 'SMTP credentials missing', next: null };
  }

  // ── Telegram ──────────────────────────────────────────────────────────────
  if (type === 'telegram') {
    const botToken = creds.telegramBotToken || config.botToken || '';
    const chatId   = config.chatId || creds.telegramChatId || '';
    const text     = config.text || `🤖 Prime Automation: ${ctx.message || ctx.topic || ctx.email || 'Workflow triggered'}`;

    if (botToken && chatId) {
      try {
        const result = await sendTelegram(botToken, chatId, text);
        helpers.log(`✅ Telegram message sent to chat ${chatId}`);
        return { ok: true, output: { chatId, text, live: true, msgId: result?.result?.message_id }, next: node.next };
      } catch (err) {
        helpers.log(`❌ Telegram error: ${err.message}`);
        return { ok: false, error: err.message, next: null };
      }
    }

    helpers.log('❌ Telegram Bot Token / Chat ID missing — cannot send Telegram message.');
    return { ok: false, error: 'Telegram credentials missing', next: null };
  }

  // ── Slack ─────────────────────────────────────────────────────────────────
  if (type === 'slack') {
    const webhookUrl = creds.slackWebhookUrl || config.webhookUrl || '';
    const text = config.text || `🚀 Prime Automation: ${ctx.message || ctx.topic || ctx.email || 'Workflow triggered'}`;

    if (webhookUrl) {
      try {
        await sendSlack(webhookUrl, text);
        helpers.log(`✅ Slack message sent`);
        return { ok: true, output: { text, live: true }, next: node.next };
      } catch (err) {
        helpers.log(`❌ Slack error: ${err.message}`);
        return { ok: false, error: err.message, next: null };
      }
    }

    helpers.log('❌ Slack Webhook URL missing — cannot send Slack message.');
    return { ok: false, error: 'Slack webhook missing', next: null };
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  if (type === 'discord') {
    const webhookUrl = config.webhookUrl || creds.discordWebhookUrl || '';
    const content = config.content || `🤖 Prime Automation: ${ctx.message || ctx.topic || ctx.email || 'Workflow triggered'}`;
    if (!webhookUrl) {
      helpers.log('❌ Discord webhook URL missing — cannot send Discord message.');
      return { ok: false, error: 'Discord webhook missing', next: null };
    }
    const res = await httpRequest(webhookUrl, 'POST', { content });
    helpers.log(`✅ Discord message sent`);
    return { ok: res.status >= 200 && res.status < 300, output: res, next: node.next };
  }

  // ── Notion ────────────────────────────────────────────────────────────────
  if (type === 'notion') {
    const token      = config.token || creds.notionToken || '';
    const databaseId = config.databaseId || creds.notionDatabaseId || '';
    const title      = config.title || 'Automation entry';

    if (!token || !databaseId) {
      helpers.log('❌ Notion credentials missing — cannot create Notion page.');
      return { ok: false, error: 'Notion credentials missing', next: null };
    }
    const res = await httpRequest(
      'https://api.notion.com/v1/pages', 'POST',
      {
        parent: { database_id: databaseId },
        properties: {
          Name: { title: [{ text: { content: String(title).slice(0, 200) } }] }
        }
      },
      { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
    );
    helpers.log(`✅ Notion page created: ${title}`);
    return { ok: res.status >= 200 && res.status < 300, output: res, next: node.next };
  }

  // ── Google Sheets ─────────────────────────────────────────────────────────
  if (type === 'googlesheets') {
    const spreadsheetId = config.spreadsheetId || creds.sheetsSpreadsheetId || '';
    const sheetName     = config.sheetName || 'Sheet1';
    const saJson        = creds.googleServiceAccount || '';
    // Build row values from comma-separated template columns
    const colsTemplate  = config.columns || '{{name}},{{email}},{{score}}';
    const values        = colsTemplate.split(',').map((c) => interpolate(c.trim(), ctx));

    if (!saJson || !spreadsheetId) {
      helpers.log('❌ Google Sheets credentials missing — cannot append row.');
      return { ok: false, error: 'Google Sheets credentials missing', next: null };
    }

    try {
      const result = await appendGoogleSheet(saJson, spreadsheetId, sheetName, values);
      helpers.log(`✅ Google Sheets row appended: [${values.join(', ')}]`);
      return { ok: true, output: { live: true, values, updates: result?.updates }, next: node.next };
    } catch (err) {
      helpers.log(`❌ Google Sheets error: ${err.message}`);
      return { ok: false, error: err.message, next: null };
    }
  }

  // ── Social ────────────────────────────────────────────────────────────────
  if (type === 'social.facebook' || type === 'social.youtube') {
    const platform = type === 'social.facebook' ? 'fb' : 'yt';
    const title = String(config.title || ctx.message || ctx.topic || 'Automation post').slice(0, 120);
    const item = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title,
      type: platform,
      time: new Date().toLocaleString(),
      media: config.media || '',
      source: 'automation-engine',
      createdAt: new Date().toISOString()
    };
    pushSocialItem(item);
    helpers.emitSocial(item);
    return { ok: true, output: item, next: node.next };
  }

  // ── Log ───────────────────────────────────────────────────────────────────
  if (type === 'log') {
    const message = config.message || 'log';
    helpers.log(message);
    return { ok: true, output: { message }, next: node.next };
  }

  return { ok: false, error: `Unknown node type: ${type}`, next: null };
}



module.exports = {
  NODE_CATALOG,
  executeNode,
  interpolate,
  deepInterpolate,
  defaultConfig,
  metaFor
};
