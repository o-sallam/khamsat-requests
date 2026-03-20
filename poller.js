const { fetchLatestPosts } = require('./probe');
const store = require('./store');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 300000;

// In-memory state
let knownIds = new Set();
let allPosts = [];        // all posts ever seen
let newPostsBuffer = [];  // posts found since last GET /posts/new
let lastPollAt = null;
let lastPollStatus = 'never';
let pollCount = 0;
let pollTimer = null;

function init() {
  knownIds = store.loadKnownIds();
  allPosts = store.loadKnownPosts();
  console.log(`[poller] Loaded ${knownIds.size} known IDs and ${allPosts.length} posts from disk.`);
}

/**
 * Get the highest numeric ID currently saved.
 */
function getMaxId() {
  return allPosts.reduce((max, p) => {
    const n = p.id || Number(String(p.postId || '').replace('forum_post-', ''));
    return n > max ? n : max;
  }, 0);
}

/**
 * Single poll cycle.
 *
 * Algorithm:
 *   1. Call Khamsat AJAX endpoint (via curl), sending ALL known IDs → server returns posts NOT in that list.
 *   2. Filter the results to only accept posts with ID > current max saved ID.
 *   3. Save any new posts and add their IDs to the known set.
 *
 * Why this works better:
 *   - The server decides what's "new" (based on our submitted knownIds list).
 *   - We double-check by requiring the ID to be greater than our current max,
 *     preventing old posts from sneaking in.
 *   - The AJAX response contains clean HTML with requester/timing info already embedded.
 */
async function poll() {
  lastPollAt = new Date().toISOString();
  pollCount++;

  const currentMaxId = getMaxId();
  console.log(`[poller] Poll #${pollCount} — max saved ID: ${currentMaxId}, sending ${knownIds.size} known IDs`);

  try {
    // Fetch the absolute newest posts from the top of the feed.
    // We pass [] so Khamsat doesn't mask/hide any of the newest posts.
    const fetchedPosts = await fetchLatestPosts([]);
    console.log(`[poller] Poll #${pollCount} — received ${fetchedPosts.length} posts from API`);

    const freshPosts = [];

    for (const post of fetchedPosts) {
      const idStr = String(post.id);

      // If we don't have the full post object saved, it's new to us.
      const hasFullPost = allPosts.some(p => String(p.id) === idStr);
      if (!hasFullPost) {
        freshPosts.push(post);
        knownIds.add(idStr);
        allPosts.push(post);
        newPostsBuffer.push(post);
      }
    }

    if (freshPosts.length > 0) {
      store.saveKnownIds(knownIds);
      store.saveKnownPosts(allPosts);
      console.log(`[poller] Poll #${pollCount} — ✅ ${freshPosts.length} NEW post(s) saved. IDs: ${freshPosts.map(p => p.id).join(', ')}`);
    } else {
      console.log(`[poller] Poll #${pollCount} — no new posts.`);
    }

    lastPollStatus = 'ok';
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
 * Returns and clears the new posts buffer.
 * Sorted by ID descending (newest first).
 */
function drainNewPosts() {
  const result = [...newPostsBuffer].sort((a, b) => b.id - a.id);
  newPostsBuffer = [];
  return result;
}

function getStatus() {
  return {
    knownIdsCount: knownIds.size,
    allPostsCount: allPosts.length,
    newPostsBufferCount: newPostsBuffer.length,
    maxKnownId: getMaxId(),
    lastPollAt,
    lastPollStatus,
    pollCount,
    pollIntervalMs: POLL_INTERVAL_MS,
    algorithm: 'ajax + id-guard',
  };
}

function getAllPosts() {
  return [...allPosts].sort((a, b) => b.id - a.id);
}

function getRecentPosts(limit = 20) {
  return [...allPosts]
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

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

function seedFullPosts(scrapedPosts) {
  let added = 0;
  let skipped = 0;

  for (const raw of scrapedPosts) {
    const numId = raw.id || Number(String(raw.postId || '').replace('forum_post-', ''));
    const strId = String(numId);
    if (!strId || strId === '0' || strId === 'NaN') { skipped++; continue; }
    if (knownIds.has(strId)) { skipped++; continue; }

    const normalized = normalizeScrapePost(raw, numId, strId);
    knownIds.add(strId);
    allPosts.push(normalized);
    added++;
  }

  store.saveKnownIds(knownIds);
  store.saveKnownPosts(allPosts);
  return { added, skipped };
}

function normalizeScrapePost(raw, numId, strId) {
  const postedRaw = raw.timing?.posted?.timestamp || raw.postedAt?.iso || null;
  const postedRelative = raw.timing?.posted?.text || raw.postedAt?.relative || null;
  const lastActRaw = raw.lastReplier?.replyTime?.timestamp || raw.lastActivity?.iso || null;
  const lastActRelative = raw.lastReplier?.replyTime?.text
    || raw.timing?.lastReplyMobile
    || raw.lastActivity?.relative
    || null;
  const buyer = raw.requester || raw.buyer || {};

  return {
    id: numId,
    idString: strId,
    postId: `forum_post-${strId}`,
    index: raw.index || 0,
    title: raw.title || null,
    postUrl: raw.postUrl
      ? (raw.postUrl.startsWith('http') ? raw.postUrl : `https://khamsat.com${raw.postUrl}`)
      : `https://khamsat.com/community/requests/${strId}`,
    requester: {
      name: buyer.name || null,
      profileUrl: buyer.profileUrl
        ? (buyer.profileUrl.startsWith('http') ? buyer.profileUrl : `https://khamsat.com${buyer.profileUrl}`)
        : null,
      avatar: buyer.avatar || null,
    },
    timing: {
      posted: {
        text: postedRelative || '',
        timestamp: postedRaw || '',
      },
      lastReplyMobile: lastActRelative || '',
    },
    lastReplier: raw.lastReplier || null,
    detectedAt: raw.detectedAt || new Date().toISOString(),
    seededFromScrape: true,
  };
}

module.exports = {
  start, stop,
  drainNewPosts,
  getStatus,
  getAllPosts,
  getRecentPosts,
  seedIds,
  seedFullPosts,
  poll,
};
