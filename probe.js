const { execFile } = require('child_process');
const { parse } = require('node-html-parser');

const KHAMSAT_AJAX_URL = process.env.KHAMSAT_URL || 'https://khamsat.com/ajax/load_more/community/requests';
const REQUEST_TIMEOUT_MS = 25000;

/**
 * Execute a curl command and return its stdout as a string.
 * Rejects on non-zero exit code or timeout.
 */
function curlPost(url, data, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      '-s',                         // silent
      '--max-time', String(Math.floor(REQUEST_TIMEOUT_MS / 1000)),
      '-X', 'POST',
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '-H', 'X-Requested-With: XMLHttpRequest',
      '-H', 'Referer: https://khamsat.com/community/requests',
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      '--data', data,
      ...extraArgs,
      url,
    ];

    execFile('curl', args, { timeout: REQUEST_TIMEOUT_MS + 2000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(err.message || stderr));
      resolve(stdout);
    });
  });
}

/**
 * Fetch the latest posts from Khamsat's AJAX endpoint.
 * Pass recent known IDs so the server returns only posts NOT in that list.
 *
 * We cap at the most recent 500 IDs to avoid OS arg limit (E2BIG).
 * Khamsat only needs recent context — sending more doesn't help.
 *
 * @param {string[]} knownIds  — array of ALL string IDs that are known
 * @returns {Promise<Object[]>} — array of parsed post objects
 */
async function fetchLatestPosts(knownIds = []) {
  // Sort descending numerically, take the most recent 500
  // This avoids E2BIG (arg list too long) when passing thousands of IDs to curl
  const recentIds = [...knownIds]
    .map(Number)
    .sort((a, b) => b - a)
    .slice(0, 500)
    .map(String);

  const parts = recentIds.map(id => `posts_ids[]=${encodeURIComponent(id)}`);
  const data = parts.join('&') || 'posts_ids[]=0';

  let raw;
  try {
    raw = await curlPost(KHAMSAT_AJAX_URL, data);
  } catch (err) {
    throw new Error(`curl failed: ${err.message}`);
  }

  if (!raw || !raw.trim()) {
    throw new Error('Empty response from Khamsat AJAX endpoint');
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from Khamsat: ${raw.slice(0, 120)}`);
  }

  const html = json.content || '';
  if (!html.trim()) return [];

  return parsePostsHtml(html);
}

/**
 * Direct ID probe via curl: fetch a single post page and check if it's valid.
 *
 * Returns one of:
 *   { status: 'new',       post: {...} }
 *   { status: 'not_found'             }
 *   { status: 'error',     error: msg }
 */
async function probeId(id) {
  const url = `https://khamsat.com/community/requests/${id}`;
  const args = [
    '-s',
    '--max-time', '15',
    '-L',   // follow redirects
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    '-H', 'Accept: text/html',
    '-w', '\n__STATUS__%{http_code}__FINALURL__%{url_effective}',
    url
  ];

  return new Promise((resolve) => {
    execFile('curl', args, { timeout: 17000 }, (err, stdout, stderr) => {
      if (err) return resolve({ status: 'error', error: err.message });

      // Parse status and final URL from the -w trailer
      const match = stdout.match(/\n__STATUS__(\d+)__FINALURL__(.+)$/);
      if (!match) return resolve({ status: 'error', error: 'Cannot parse curl output' });

      const httpStatus = Number(match[1]);
      const finalUrl = match[2].trim();
      const body = stdout.slice(0, stdout.lastIndexOf('\n__STATUS__'));

      // Redirected away from the expected URL → post doesn't exist
      if (!finalUrl.includes(`/community/requests/${id}`)) {
        console.log(`[probe] ID ${id} → redirected (not found)`);
        return resolve({ status: 'not_found' });
      }

      if (httpStatus === 403 || httpStatus === 404) {
        console.log(`[probe] ID ${id} → HTTP ${httpStatus} (not found)`);
        return resolve({ status: 'not_found' });
      }

      // Check for Arabic 404 page
      if (body.includes('غير موجودة') || body.includes('404')) {
        console.log(`[probe] ID ${id} → 404 page content`);
        return resolve({ status: 'not_found' });
      }

      // Parse the page
      const post = parsePostPage(body, id, url);
      if (!post) {
        // Might be a JS-challenge page — we know the ID exists, create a stub
        if (httpStatus === 202 || body.length < 500) {
          console.log(`[probe] ID ${id} → JS-gated, creating stub`);
          return resolve({
            status: 'new',
            post: {
              id: Number(id),
              idString: String(id),
              postId: `forum_post-${id}`,
              index: 0,
              title: null,
              postUrl: `/community/requests/${id}`,
              requester: { name: null, profileUrl: null, avatar: null },
              timing: { posted: { text: '', timestamp: '' }, lastReplyMobile: '' },
              lastReplier: null,
              detectedAt: new Date().toISOString(),
              discoveredVia: 'probe-stub',
            }
          });
        }
        return resolve({ status: 'not_found' });
      }

      console.log(`[probe] ID ${id} → ✅ FOUND: "${post.title}"`);
      return resolve({ status: 'new', post });
    });
  });
}

/**
 * Parse the full post page HTML and extract relevant fields.
 */
function parsePostPage(html, id, url) {
  if (!html || html.length < 100) return null;
  const root = parse(html);

  const pageTitle = root.querySelector('title')?.text || '';
  if (pageTitle.includes('غير موجودة') || pageTitle.includes('404')) return null;

  const titleEl = root.querySelector('h1.details-head') || root.querySelector('h1');
  const title = titleEl ? titleEl.text.trim() : null;
  if (!title) return null;

  const articleEl = root.querySelector('article.replace_urls');
  
  let content = null;
  if (articleEl) {
    let rawHtml = articleEl.innerHTML;
    // Replace <br> and <p> with spaces to avoid merging words
    rawHtml = rawHtml.replace(/<(br|p|div)\s*\/?>/gi, ' ');
    // Strip all HTML tags
    rawHtml = rawHtml.replace(/<[^>]+>/g, '');
    // Replace html entities (basic ones)
    rawHtml = rawHtml.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    content = rawHtml.replace(/\s+/g, ' ').trim();
  }

  const requesterLink = root.querySelector('.details-list a.user, a.user');
  const requesterAvatar = root.querySelector('.avatar-td img, .user-info img');

  const requester = {
    name: requesterLink ? requesterLink.text.trim() : null,
    profileUrl: requesterLink ? requesterLink.getAttribute('href') : null,
    avatar: requesterAvatar ? requesterAvatar.getAttribute('src') : null,
  };

  let timeText = '';
  let timeStr = '';
  const timeSpans = root.querySelectorAll('span[title]');
  for (const span of timeSpans) {
      if (span.getAttribute('title')?.includes('GMT')) {
          timeText = span.text.trim();
          timeStr = span.getAttribute('title');
          break;
      }
  }

  const timing = {
    posted: {
      text: timeText,
      timestamp: timeStr,
    },
    lastReplyMobile: '',
  };

  return {
    id: Number(id),
    idString: String(id),
    postId: `forum_post-${id}`,
    index: 0,
    title,
    content, // The newly added content
    postUrl: `/community/requests/${id}`,
    requester,
    timing,
    lastReplier: null,
    detectedAt: new Date().toISOString(),
    discoveredVia: 'probe',
  };
}

/**
 * Parse the AJAX HTML rows.
 */
function parsePostsHtml(html) {
  const root = parse(html);
  const rows = root.querySelectorAll('tr.forum_post');
  const posts = [];

  for (const row of rows) {
    try {
      const idAttr = row.getAttribute('id') || '';
      const idNum = Number(idAttr.replace('forum_post-', ''));
      if (!idNum) continue;

      const titleEl = row.querySelector('td.details-td h3.details-head a');
      const title = titleEl ? titleEl.text.trim() : null;
      const postUrl = titleEl ? titleEl.getAttribute('href') : null;

      const users = row.querySelectorAll('td.details-td a.user');
      const requesterEl = users[0];
      const requester = {
        name: requesterEl ? requesterEl.text.trim() : null,
        profileUrl: requesterEl ? requesterEl.getAttribute('href') : null,
        avatar: row.querySelector('td.avatar-td img')?.getAttribute('src') || null,
      };

      const replierEl = users[1];
      const timeSpans = row.querySelectorAll('td.details-td span[title]');
      const postedSpan = timeSpans[0];
      const activitySpan = timeSpans[1];

      const timing = {
        posted: {
          text: postedSpan ? postedSpan.text.trim() : '',
          timestamp: postedSpan ? postedSpan.getAttribute('title') : '',
        },
        lastReplyMobile: activitySpan ? activitySpan.text.trim() : '',
      };

      const lastReplier = replierEl ? {
        name: replierEl.text.trim(),
        profileUrl: replierEl.getAttribute('href'),
        avatar: null,
        replyTime: {
          text: activitySpan ? activitySpan.text.trim() : '',
          timestamp: activitySpan ? activitySpan.getAttribute('title') : '',
        }
      } : null;

      posts.push({
        id: idNum,
        idString: String(idNum),
        postId: idAttr,
        index: 0,
        title,
        postUrl,
        requester,
        timing,
        lastReplier,
        detectedAt: new Date().toISOString(),
        discoveredVia: 'ajax',
      });
    } catch (err) {
      console.error(`[parser] Failed to parse row: ${err.message}`);
    }
  }

  return posts;
}

module.exports = { fetchLatestPosts, probeId, parsePostsHtml };
