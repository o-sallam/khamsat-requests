const fetch = require('node-fetch');
const { parsePostsHtml } = require('./parser');
const store = require('./store');

const KHAMSAT_URL = process.env.KHAMSAT_URL || 'https://khamsat.com/ajax/load_more/community/requests';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 120000;

// In-memory state (also synced to disk)
let knownIds = new Set();
let allPosts = [];        // all posts ever seen, keyed by postId
let newPostsBuffer = [];  // posts found since last GET /posts/new
let lastPollAt = null;
let lastPollStatus = 'never';
let pollCount = 0;
let pollTimer = null;

function init() {
  knownIds = store.loadKnownIds();
  allPosts = store.loadKnownPosts();
  console.log(`[poller] Loaded ${knownIds.size} known IDs from disk.`);
}

/**
 * Build the FormData body: posts_ids[] for each known ID
 */
function buildPayload(ids) {
  const params = new URLSearchParams();
  for (const id of ids) {
    params.append('posts_ids[]', id);
  }
  return params;
}

/**
 * Single poll cycle: call Khamsat, parse response, detect new posts.
 */
async function poll() {
  lastPollAt = new Date().toISOString();
  pollCount++;
  console.log(`[poller] Poll #${pollCount} started — sending ${knownIds.size} known IDs`);

  try {
    const body = buildPayload(knownIds);

    const response = await fetch(KHAMSAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://khamsat.com/community/requests',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const html = json.content || '';

    if (!html.trim()) {
      lastPollStatus = 'ok_empty';
      console.log(`[poller] Poll #${pollCount} — no new posts.`);
      return;
    }

    const parsed = parsePostsHtml(html);
    console.log(`[poller] Poll #${pollCount} — got ${parsed.length} posts from API`);

    const freshPosts = [];

    for (const post of parsed) {
      if (!post.postId) continue;

      if (!knownIds.has(post.postId)) {
        // Brand new post we've never seen
        freshPosts.push(post);
        knownIds.add(post.postId);
        allPosts.push(post);
        newPostsBuffer.push(post);
      }
      // NOTE: if you later want to detect updated posts (lastActivity changed),
      // you can add that logic here by comparing with stored post data.
    }

    // Persist to disk
    store.saveKnownIds(knownIds);
    store.saveKnownPosts(allPosts);

    lastPollStatus = 'ok';
    console.log(`[poller] Poll #${pollCount} — ${freshPosts.length} NEW posts detected.`);

  } catch (err) {
    lastPollStatus = `error: ${err.message}`;
    console.error(`[poller] Poll #${pollCount} FAILED:`, err.message);
  }
}

/**
 * Start the polling loop.
 */
function start() {
  init();
  poll(); // run immediately on start
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[poller] Polling every ${POLL_INTERVAL_MS / 1000}s`);
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
}

/**
 * Returns and clears the new posts buffer (consumed by GET /posts/new).
 */
function drainNewPosts() {
  const result = [...newPostsBuffer];
  newPostsBuffer = [];
  return result;
}

function getStatus() {
  return {
    knownIdsCount: knownIds.size,
    allPostsCount: allPosts.length,
    newPostsBufferCount: newPostsBuffer.length,
    lastPollAt,
    lastPollStatus,
    pollCount,
    pollIntervalMs: POLL_INTERVAL_MS,
  };
}

function getAllPosts() {
  return allPosts;
}

/**
 * Bulk-seed only IDs (no post data).
 * Used when you just have a list of IDs and want to mark them as known.
 */
function seedIds(ids) {
  let added = 0;
  for (const id of ids) {
    const strId = String(id);
    if (!knownIds.has(strId)) {
      knownIds.add(strId);
      added++;
    }
  }
  store.saveKnownIds(knownIds);
  return added;
}

/**
 * Bulk-seed full post objects from your scraped JSON file.
 * Normalizes your scraper's schema → our internal schema.
 * Returns { added, skipped } counts.
 */
function seedFullPosts(scrapedPosts) {
  let added = 0;
  let skipped = 0;

  for (const raw of scrapedPosts) {
    const postId = String(raw.id || raw.postId || '').replace('forum_post-', '');
    if (!postId) { skipped++; continue; }

    if (knownIds.has(postId)) { skipped++; continue; }

    // Normalize scraper schema → internal schema
    const normalized = normalizeScrapePost(raw, postId);
    knownIds.add(postId);
    allPosts.push(normalized);
    added++;
  }

  store.saveKnownIds(knownIds);
  store.saveKnownPosts(allPosts);
  return { added, skipped };
}

/**
 * Convert your scraper's post shape to our internal shape.
 * Handles both the scraper format and our own parser format gracefully.
 */
function normalizeScrapePost(raw, postId) {
  // --- Posted time ---
  const postedRaw = raw.timing?.posted?.timestamp || raw.postedAt?.iso || null;
  const postedRelative = raw.timing?.posted?.text || raw.postedAt?.relative || null;

  // --- Last activity ---
  const lastActRaw = raw.lastReplier?.replyTime?.timestamp || raw.lastActivity?.iso || null;
  const lastActRelative = raw.lastReplier?.replyTime?.text
    || raw.timing?.lastReplyMobile
    || raw.lastActivity?.relative
    || null;

  // --- Buyer / requester ---
  const buyer = raw.requester || raw.buyer || {};

  return {
    postId,
    title: raw.title || null,
    postUrl: raw.postUrl
      ? (raw.postUrl.startsWith('http') ? raw.postUrl : `https://khamsat.com${raw.postUrl}`)
      : null,
    buyer: {
      name: buyer.name || null,
      profileUrl: buyer.profileUrl
        ? (buyer.profileUrl.startsWith('http') ? buyer.profileUrl : `https://khamsat.com${buyer.profileUrl}`)
        : null,
      avatar: buyer.avatar || null,
    },
    postedAt: {
      iso: postedRaw ? parseKhamsatDate(postedRaw) : null,
      relative: postedRelative,
    },
    lastActivity: {
      iso: lastActRaw ? parseKhamsatDate(lastActRaw) : null,
      relative: lastActRelative,
    },
    detectedAt: raw.detectedAt || new Date().toISOString(),
    seededFromScrape: true,
  };
}

/**
 * Parse "DD/MM/YYYY HH:MM:SS GMT" or already-ISO strings.
 */
function parseKhamsatDate(raw) {
  if (!raw) return null;
  // Already ISO
  if (raw.includes('T')) return raw;
  try {
    const [datePart, timePart] = raw.trim().split(' ');
    const [day, month, year] = datePart.split('/');
    return new Date(`${year}-${month}-${day}T${timePart}Z`).toISOString();
  } catch {
    return raw;
  }
}

/**
 * Returns posts sorted by publish time (newest first).
 * This is the alternative to Khamsat's default "last activity" ordering.
 */
function getRecentPosts(limit = 20) {
  return [...allPosts]
    .filter(p => p.postedAt?.iso)
    .sort((a, b) => new Date(b.postedAt.iso) - new Date(a.postedAt.iso))
    .slice(0, limit);
}

module.exports = {
  start, stop,
  drainNewPosts,
  getStatus,
  getAllPosts,
  getRecentPosts,
  seedIds,
  seedFullPosts,
};
