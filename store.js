const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const IDS_FILE = path.join(DATA_DIR, 'known_ids.json');
const POSTS_FILE = path.join(DATA_DIR, 'known_posts.json');

// Ensure data directory and files exist
function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(IDS_FILE)) fs.writeFileSync(IDS_FILE, JSON.stringify([]));
  if (!fs.existsSync(POSTS_FILE)) fs.writeFileSync(POSTS_FILE, JSON.stringify([]));
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
  fs.writeFileSync(IDS_FILE, JSON.stringify([...idSet], null, 2));
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
  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
}

module.exports = { init, loadKnownIds, saveKnownIds, loadKnownPosts, saveKnownPosts };
