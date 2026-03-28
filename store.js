const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const IDS_FILE = path.join(DATA_DIR, 'known_ids.json');
const POSTS_FILE = path.join(DATA_DIR, 'known_posts.json');
const USERS_FILE = path.join(DATA_DIR, 'known_users.json');

// Ensure data directory and files exist
function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(IDS_FILE)) fs.writeFileSync(IDS_FILE, JSON.stringify([]));
  if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, JSON.stringify([]));
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));
}

function loadKnownIds() {
  try {
    const raw = fs.readFileSync(IDS_FILE, 'utf8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveKnownIds(idSet) {
  let existing = new Set();
  try {
    const raw = fs.readFileSync(IDS_FILE, 'utf8');
    if (raw && raw.trim().length > 0) {
      existing = new Set(JSON.parse(raw));
    }
  } catch {
    existing = new Set();
  }

  // Merge new IDs with existing
  for (const id of idSet) {
    existing.add(id);
  }

  const sorted = [...existing]
    .map(Number)
    .sort((a, b) => b - a)
    .map(String);
    
  if (sorted.length === 0 && existing.size > 0) {
    console.error('[store] ALERT: Attempted to write empty IDs array! Aborting save.');
    return;
  }

  fs.writeFileSync(IDS_FILE, JSON.stringify(sorted, null, 2));
}

function loadKnownPosts() {
  try {
    const raw = fs.readFileSync(POSTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveKnownPosts(posts) {
  let existing = [];
  try {
    const raw = fs.readFileSync(POSTS_FILE, 'utf8');
    if (raw && raw.trim().length > 0) {
      existing = JSON.parse(raw);
    }
  } catch {
    existing = [];
  }

  // Ensure existing is an array
  if (!Array.isArray(existing)) {
    existing = [];
  }

  const mergedById = new Map();
  for (const post of existing) {
    const key = String(post.id || post.postId || '');
    if (key) mergedById.set(key, post);
  }
  for (const post of posts) {
    const key = String(post.id || post.postId || '');
    if (key) mergedById.set(key, post);
  }

  const merged = [...mergedById.values()];
  const sorted = merged.sort((a, b) => (b.id || 0) - (a.id || 0));
  
  // NEVER write an empty array if we had data before, unless both are truly empty
  if (sorted.length === 0 && existing.length > 0) {
    console.error('[store] ALERT: Attempted to write empty posts array! Aborting save.');
    return;
  }
  
  fs.writeFileSync(POSTS_FILE, JSON.stringify(sorted, null, 2));
}

function loadKnownUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveKnownUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

module.exports = { init, loadKnownIds, saveKnownIds, loadKnownPosts, saveKnownPosts, loadKnownUsers, saveKnownUsers };
