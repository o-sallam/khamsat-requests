const { fetchLatestPosts, probeId } = require('./probe');
const store = require('./store');

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 300000;

// Helper to add fake delay between requests
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

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

      // If we don't have the full post object OR it was saved as a stub, process it.
      const existingIdx = allPosts.findIndex(p => String(p.id) === idStr);
      const isNew = existingIdx === -1;
      const isStub = !isNew && !allPosts[existingIdx].title;

      if (isNew || isStub) {
        
        // --- ADDED GAP: don't slam the server ---
        await sleep(2000 + Math.random() * 2000);

        // Fetch article content immediately!
        try {
          console.log(`[poller] Probing new post ID ${idStr} with custom URL...`);
          // Pass the postUrl explicitly if coming from AJAX
          const probeRes = await probeId(post.id, post.postUrl);
          if (probeRes.status === 'new' && probeRes.post) {
            if (probeRes.post.postDetails) {
              post.postDetails = probeRes.post.postDetails;
              console.log(`[poller] ✅ Acquired details for ID ${idStr}`);
            }
            if (probeRes.post.requester?.userType) {
              post.requester.userType = probeRes.post.requester.userType;
              post.requester.level = probeRes.post.requester.userType; // sync both
              console.log(`[poller] ✅ Acquired user type for ${post.requester.name}: ${post.requester.userType}`);
            }
          }
        } catch (e) {
          console.error(`[poller] ⚠️ Failed to probe ID ${idStr}:`, e.message);
        }

        freshPosts.push(post);
        knownIds.add(idStr);
        if (isNew) {
          allPosts.push(post);
        } else {
          allPosts[existingIdx] = post;
        }
        newPostsBuffer.push(post);

        // --- ATOMIC SAVE ---
        store.saveKnownIds(knownIds);
        store.saveKnownPosts(allPosts);
      }
    }

    // --- PREDICTIVE PROBING ---
    const lastMaxId = getMaxId();
    console.log(`[poller] Predictive probing starting from ID ${lastMaxId + 1}...`);
    for (let nextId = lastMaxId + 1; nextId <= lastMaxId + 3; nextId++) {
      const idStr = String(nextId);
      if (knownIds.has(idStr)) continue;

      await sleep(2500 + Math.random() * 2500);

      try {
        const res = await probeId(nextId);
        if (res.status === 'new' && res.post) {
          console.log(`[poller] 🎯 FOUND FUTURE POST ${nextId} via predictive probe!`);
          
          const post = res.post;
          freshPosts.push(post);
          knownIds.add(idStr);
          allPosts.push(post);
          newPostsBuffer.push(post);

          // Save immediately
          store.saveKnownIds(knownIds);
          store.saveKnownPosts(allPosts);
        }
      } catch (e) {
        console.error(`[poller] ⚠️ Predictive probe failed for ID ${nextId}:`, e.message);
      }
    }

    if (freshPosts.length > 0) {
      console.log(`[poller] Poll #${pollCount} — finished cycle with ${freshPosts.length} new/updated entries.`);
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
    postDetails: raw.postDetails || null,
    postUrl: raw.postUrl
      ? (raw.postUrl.startsWith('http') ? raw.postUrl : `https://khamsat.com${raw.postUrl}`)
      : `https://khamsat.com/community/requests/${strId}`,
    requester: {
      name: buyer.name || null,
      profileUrl: buyer.profileUrl
        ? (buyer.profileUrl.startsWith('http') ? buyer.profileUrl : `https://khamsat.com${buyer.profileUrl}`)
        : null,
      avatar: buyer.avatar || null,
      userType: buyer.userType || buyer.level || null,
      level: buyer.level || buyer.userType || null,
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

/**
 * Re-scan posts that are missing postDetails or buyer level.
 * Fetches full page content for each post and updates the stored data.
 */
async function rescanPosts(posts) {
  console.log(`[poller] Re-scanning ${posts.length} posts for missing details...`);
  
  for (const post of posts) {
    const idStr = String(post.id);
    
    // Add delay to avoid rate limiting
    await sleep(3000 + Math.random() * 2000);
    
    try {
      console.log(`[poller] Re-scanning post ID ${idStr}...`);
      const probeRes = await probeId(post.id, post.postUrl);
      
      if (probeRes.status === 'new' && probeRes.post) {
        const idx = allPosts.findIndex(p => String(p.id) === idStr);
        if (idx !== -1) {
          // Update with new details
          if (probeRes.post.postDetails) {
            allPosts[idx].postDetails = probeRes.post.postDetails;
            console.log(`[poller] ✅ Updated postDetails for ID ${idStr}`);
          }
          if (probeRes.post.requester?.userType) {
            allPosts[idx].requester = allPosts[idx].requester || {};
            allPosts[idx].requester.userType = probeRes.post.requester.userType;
            allPosts[idx].requester.level = probeRes.post.requester.userType;
            console.log(`[poller] ✅ Updated user type for ID ${idStr}: ${probeRes.post.requester.userType}`);
          }
          // Save after each successful update
          store.saveKnownPosts(allPosts);
        }
      }
    } catch (e) {
      console.error(`[poller] ⚠️ Re-scan failed for ID ${idStr}:`, e.message);
    }
  }
  
  console.log(`[poller] Re-scan complete.`);
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
  rescanPosts,
};
