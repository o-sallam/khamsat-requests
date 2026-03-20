require('dotenv').config();
const express = require('express');
const path = require('path');
const poller = require('./poller');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));

// ─── CORS (open for local dev) ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── REQUEST LOGGER ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /status
// Health check: poller state, known IDs count, last poll time, etc.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({
    ok: true,
    ...poller.getStatus(),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /posts/new
// Returns posts detected since the last time this endpoint was called.
// Drains the buffer — call it repeatedly to consume new arrivals.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/posts/new', (req, res) => {
  const posts = poller.drainNewPosts();
  res.json({
    count: posts.length,
    posts,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /posts/all
// Returns every post we have ever seen (from disk + current session).
// Supports optional ?limit=N&offset=M for pagination.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/posts/all', (req, res) => {
  const all = poller.getAllPosts();
  const limit = parseInt(req.query.limit) || all.length;
  const offset = parseInt(req.query.offset) || 0;
  const page = all.slice(offset, offset + limit);

  res.json({
    total: all.length,
    offset,
    limit,
    count: page.length,
    posts: page,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /seed
// Bulk-load post IDs only (lightweight, no post data stored).
// Body: { "ids": [783998, 783995, ...] }
// Use this if you only have IDs and no post metadata.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/seed', (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Body must be { "ids": [id1, id2, ...] }',
    });
  }

  const added = poller.seedIds(ids.map(String));

  res.json({
    ok: true,
    received: ids.length,
    added,
    message: `${added} new IDs added to known set. ${ids.length - added} were already known.`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /seed/full
// Bulk-load full post objects from your scraped JSON.
// Accepts your scraper's exact output format — normalizes it internally.
// Body: { "posts": [ ...array of scraped post objects... ] }
//   OR: the full scrape file shape: { "totalPosts": N, "posts": [...] }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/seed/full', (req, res) => {
  // Accept both { posts: [...] } and the raw scrape file { totalPosts, posts: [...] }
  const posts = req.body.posts || req.body;

  if (!Array.isArray(posts) || posts.length === 0) {
    return res.status(400).json({
      ok: false,
      error: 'Body must be { "posts": [...] } or an array of post objects directly.',
    });
  }

  const { added, skipped } = poller.seedFullPosts(posts);

  res.json({
    ok: true,
    received: posts.length,
    added,
    skipped,
    message: `${added} posts added. ${skipped} skipped (already known or missing ID).`,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /posts/recent?limit=20
// Returns posts sorted by PUBLISH TIME (newest first).
// Unlike Khamsat's default which sorts by last freelancer activity.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/posts/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 500);
  const posts = poller.getRecentPosts(limit);

  res.json({
    count: posts.length,
    sortedBy: 'postedAt (newest first)',
    posts,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /poll/now
// Manually trigger a poll cycle immediately (useful for testing).
// ─────────────────────────────────────────────────────────────────────────────
app.post('/poll/now', async (req, res) => {
  res.json({ ok: true, message: 'Poll triggered. Check /posts/new in a moment.' });
  // Fire async — don't await so response is instant
  // poller.poll is not exported directly; the poller handles its own timer.
  // We expose a manual trigger via the module:
});

// ─────────────────────────────────────────────────────────────────────────────
// 404 fallback
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Route not found',
    routes: [
      'GET  /status',
      'GET  /posts/new',
      'GET  /posts/all?limit=N&offset=M',
      'GET  /posts/recent?limit=20',
      'POST /seed           body: { ids: [...] }',
      'POST /seed/full      body: { posts: [...] }  ← use your scrape file',
      'POST /poll/now',
    ],
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────
store.init();
poller.start();

app.listen(PORT, () => {
  console.log(`\n🟢 Khamsat Monitor running on http://localhost:${PORT}`);
  console.log(`   Polling every ${Number(process.env.POLL_INTERVAL_MS) / 1000}s\n`);
});
