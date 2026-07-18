const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

function ensureAuthFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '[]', 'utf8');
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function listUsers() {
  ensureAuthFiles();
  return readJson(USERS_FILE, []);
}

function saveUsers(users) {
  ensureAuthFiles();
  writeJson(USERS_FILE, users);
}

function listSessions() {
  ensureAuthFiles();
  return readJson(SESSIONS_FILE, []);
}

function saveSessions(sessions) {
  ensureAuthFiles();
  writeJson(SESSIONS_FILE, sessions);
}

async function createUser({ name, email, password, role = 'user' }) {
  const users = listUsers();
  const normalizedName = String(name || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const rawPassword = String(password || '');

  if (!normalizedName) throw new Error('Name is required');
  if (!normalizedEmail) throw new Error('Email is required');
  if (rawPassword.length < 6) throw new Error('Password must be at least 6 characters long');
  if (users.some(user => user.email === normalizedEmail)) throw new Error('This email is already registered');

  const now = new Date().toISOString();
  const user = {
    id: uid('usr'),
    name: normalizedName,
    email: normalizedEmail,
    passwordHash: await bcrypt.hash(rawPassword, 10),
    role,
    createdAt: now,
    updatedAt: now
  };
  users.push(user);
  saveUsers(users);
  return publicUser(user);
}

async function verifyUser(email, password) {
  const users = listUsers();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = users.find(entry => entry.email === normalizedEmail);
  if (!user) return null;
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash || '');
  if (!ok) return null;
  return publicUser(user);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    uid: user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'user',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function createSession(userId) {
  const sessions = listSessions();
  const now = new Date().toISOString();
  const session = {
    token: uid('sess'),
    userId,
    createdAt: now,
    updatedAt: now
  };
  sessions.push(session);
  saveSessions(sessions);
  return session;
}

function getSession(token) {
  const sessions = listSessions();
  return sessions.find(entry => entry.token === token) || null;
}

function deleteSession(token) {
  const sessions = listSessions().filter(entry => entry.token !== token);
  saveSessions(sessions);
}

function getUserById(id) {
  const users = listUsers();
  return publicUser(users.find(entry => entry.id === id) || null);
}

module.exports = {
  ensureAuthFiles,
  createUser,
  verifyUser,
  createSession,
  getSession,
  deleteSession,
  getUserById
};
