const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const WORKFLOWS_DIR = path.join(DATA_DIR, 'workflows');
const RUNS_DIR = path.join(DATA_DIR, 'runs');
const SOCIAL_DIR = path.join(DATA_DIR, 'social');
const SOCIAL_QUEUE_FILE = path.join(SOCIAL_DIR, 'queue.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');

function ensureDirs() {
  for (const dir of [DATA_DIR, WORKFLOWS_DIR, RUNS_DIR, SOCIAL_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SOCIAL_QUEUE_FILE)) {
    fs.writeFileSync(SOCIAL_QUEUE_FILE, '[]', 'utf8');
  }
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function defaultWorkflows() {
  return [
    {
      id: 'wf_fb_poster',
      name: 'Facebook Social Auto-Poster',
      description: 'Webhook/manual → AI rewrite → Facebook Autopilot queue',
      enabled: true,
      schedule: { enabled: false, everyMinutes: 60 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: 'n1', type: 'trigger.manual', name: 'Manual / Webhook', x: 40, y: 120, config: {}, next: 'n2' },
        { id: 'n2', type: 'set', name: 'Normalize Post', x: 260, y: 120, config: { assignments: { message: '{{payload.message || "Launch your AI SaaS today"}}', platform: 'fb' } }, next: 'n3' },
        { id: 'n3', type: 'ai.rewrite', name: 'AI Copywriter', x: 480, y: 120, config: { field: 'message', style: 'engaging' }, next: 'n4' },
        { id: 'n4', type: 'condition', name: 'Has Message?', x: 700, y: 120, config: { left: '{{message}}', operator: 'notEmpty', right: '' }, nextTrue: 'n5', nextFalse: 'n6' },
        { id: 'n5', type: 'social.facebook', name: 'Queue Facebook Post', x: 920, y: 60, config: { title: '{{message}}' }, next: null },
        { id: 'n6', type: 'log', name: 'Skip Empty', x: 920, y: 200, config: { message: 'Skipped: empty message' }, next: null }
      ]
    },
    {
      id: 'wf_yt_broadcast',
      name: 'YouTube Script Broadcaster',
      description: 'Schedule/manual → AI script → YouTube Autopilot + Discord',
      enabled: true,
      schedule: { enabled: false, everyMinutes: 1440 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: 'n1', type: 'trigger.schedule', name: 'Schedule Trigger', x: 40, y: 140, config: {}, next: 'n2' },
        { id: 'n2', type: 'set', name: 'Topic Input', x: 260, y: 140, config: { assignments: { topic: '{{payload.topic || "AI automations you can build today"}}' } }, next: 'n3' },
        { id: 'n3', type: 'delay', name: 'Warm-up Delay', x: 480, y: 140, config: { ms: 800 }, next: 'n4' },
        { id: 'n4', type: 'ai.rewrite', name: 'Script Outline', x: 700, y: 140, config: { field: 'topic', style: 'youtube' }, next: 'n5' },
        { id: 'n5', type: 'social.youtube', name: 'Queue YouTube', x: 920, y: 80, config: { title: '{{topic}}' }, next: 'n6' },
        { id: 'n6', type: 'discord', name: 'Discord Alert', x: 1140, y: 140, config: { content: 'New YouTube draft queued: {{topic}}' }, next: null }
      ]
    },
    {
      id: 'wf_saas_leads',
      name: 'SaaS Lead Webhook Pipeline',
      description: 'Webhook lead → filter → score branch → Notion / email',
      enabled: true,
      schedule: { enabled: false, everyMinutes: 60 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        { id: 'n1', type: 'trigger.webhook', name: 'Webhook Receiver', x: 40, y: 140, config: {}, next: 'n2' },
        { id: 'n2', type: 'filter', name: 'Has Email?', x: 260, y: 140, config: { field: 'email', operator: 'notEmpty' }, next: 'n3' },
        { id: 'n3', type: 'set', name: 'Score Lead', x: 480, y: 140, config: { assignments: { score: '{{Number(payload.score || 0.8)}}', name: '{{payload.name || "Lead"}}', email: '{{payload.email}}' } }, next: 'n4' },
        { id: 'n4', type: 'condition', name: 'High Score?', x: 700, y: 140, config: { left: '{{score}}', operator: 'gte', right: '0.7' }, nextTrue: 'n5', nextFalse: 'n7' },
        { id: 'n5', type: 'notion', name: 'Write Notion', x: 920, y: 60, config: { title: '{{name}} — {{email}}', properties: { score: '{{score}}', tier: 'enterprise' } }, next: 'n6' },
        { id: 'n6', type: 'email', name: 'Notify Sales', x: 1140, y: 60, config: { to: 'sales@example.com', subject: 'Hot lead: {{name}}', body: 'Email: {{email}} Score: {{score}}' }, next: null },
        { id: 'n7', type: 'log', name: 'Ignore Low Score', x: 920, y: 220, config: { message: 'Ignored lead {{email}} score={{score}}' }, next: null }
      ]
    }
  ];
}

function seedIfEmpty() {
  ensureDirs();
  const files = fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    for (const wf of defaultWorkflows()) {
      writeJson(path.join(WORKFLOWS_DIR, `${wf.id}.json`), wf);
    }
  }
}

function listWorkflows() {
  seedIfEmpty();
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(WORKFLOWS_DIR, f), null))
    .filter(Boolean)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function getWorkflow(id) {
  const file = path.join(WORKFLOWS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file, null);
}

function saveWorkflow(workflow) {
  ensureDirs();
  if (!workflow.id) workflow.id = uid('wf');
  workflow.updatedAt = new Date().toISOString();
  if (!workflow.createdAt) workflow.createdAt = workflow.updatedAt;
  writeJson(path.join(WORKFLOWS_DIR, `${workflow.id}.json`), workflow);
  return workflow;
}

function deleteWorkflow(id) {
  const file = path.join(WORKFLOWS_DIR, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

function saveRun(run) {
  ensureDirs();
  if (!run.id) run.id = uid('run');
  writeJson(path.join(RUNS_DIR, `${run.id}.json`), run);
  return run;
}

function listRuns(workflowId, limit = 30) {
  ensureDirs();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(RUNS_DIR, f), null))
    .filter(Boolean)
    .filter((r) => !workflowId || r.workflowId === workflowId)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, limit);
}

function getRun(id) {
  const file = path.join(RUNS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return readJson(file, null);
}

function getSocialQueue() {
  ensureDirs();
  return readJson(SOCIAL_QUEUE_FILE, []);
}

function pushSocialItem(item) {
  ensureDirs();
  const queue = getSocialQueue();
  queue.unshift(item);
  writeJson(SOCIAL_QUEUE_FILE, queue.slice(0, 100));
  return item;
}

function setSocialQueue(queue) {
  ensureDirs();
  writeJson(SOCIAL_QUEUE_FILE, queue);
  return queue;
}

let _generatedCount = 0;

function getGeneratedCount() {
  return _generatedCount;
}

function incrementGeneratedCount(n) {
  _generatedCount += (n || 1);
}

function getCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) return {};
  return readJson(CREDENTIALS_FILE, {});
}

function setCredentials(incoming) {
  ensureDirs();
  const current = getCredentials();
  const merged = { ...current, ...incoming };
  // never write empty-string keys — preserve existing values
  for (const [k, v] of Object.entries(incoming)) {
    if (v === '' || v === null || v === undefined) {
      merged[k] = current[k] ?? '';
    }
  }
  writeJson(CREDENTIALS_FILE, merged);
  return merged;
}

function getAllData() {
  ensureDirs();
  try {
    const workflows = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json')).map(f => readJson(path.join(WORKFLOWS_DIR, f), null)).filter(Boolean);
    const runs = fs.readdirSync(RUNS_DIR).filter(f => f.endsWith('.json')).map(f => readJson(path.join(RUNS_DIR, f), null)).filter(Boolean);
    const queue = getSocialQueue();
    const credentials = getCredentials();
    return { workflows, runs, queue, credentials, exportedAt: new Date().toISOString() };
  } catch (e) {
    return null;
  }
}

function restoreAllData(data) {
  ensureDirs();
  let count = 0;
  if (data.workflows) {
    for (const wf of data.workflows) {
      if (wf.id) { writeJson(path.join(WORKFLOWS_DIR, `${wf.id}.json`), wf); count++; }
    }
  }
  if (data.runs) {
    for (const run of data.runs) {
      if (run.id) { writeJson(path.join(RUNS_DIR, `${run.id}.json`), run); count++; }
    }
  }
  if (data.queue) { writeJson(SOCIAL_QUEUE_FILE, data.queue); count++; }
  if (data.credentials) { writeJson(CREDENTIALS_FILE, data.credentials); count++; }
  return count;
}

module.exports = {
  ensureDirs, seedIfEmpty, uid,
  listWorkflows, getWorkflow, saveWorkflow, deleteWorkflow,
  saveRun, listRuns, getRun,
  getSocialQueue, pushSocialItem, setSocialQueue,
  getCredentials, setCredentials,
  getGeneratedCount, incrementGeneratedCount,
  getAllData, restoreAllData
};
