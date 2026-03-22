//probe.js
const { execFile } = require('child_process');
const { parse } = require('node-html-parser');
const { parseCommentsHtml } = require('./parser');

const KHAMSAT_AJAX_URL = process.env.KHAMSAT_URL || 'https://khamsat.com/ajax/load_more/community/requests';
const REQUEST_TIMEOUT_MS = 25000;
const COOKIE_FILE = '/tmp/khamsat_cookies.txt';

/**
 * User session cookies for authenticated requests (e.g. rack.session).
 * Set KHAMSAT_COOKIES env var. Accepts:
 *   - Full header: rack.session=VALUE; khamsat_cart=...; rb=%2F
 *   - Name + value: rack.session VALUE (browser copy format)
 *   - Just value: VALUE (we prepend rack.session=)
 */
function getSessionCookies() {
  const raw = process.env.KHAMSAT_COOKIES || '';
  if (!raw.trim()) return null;
  const s = raw.trim();
  if (s.includes('=')) return s;
  if (s.toLowerCase().startsWith('rack.session')) {
    const val = s.slice(12).trim(); // "rack.session" = 12 chars
    return val ? `rack.session=${val}` : null;
  }
  return `rack.session=${s}`;
}

// Lazy-loaded Puppeteer instance
let _browser = null;
let _browserPromise = null;

async function getBrowser() {
  if (_browser) return _browser;
  if (_browserPromise) return _browserPromise;
  
  _browserPromise = (async () => {
    const puppeteer = require('puppeteer');
    _browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    return _browser;
  })();
  
  return _browserPromise;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _browserPromise = null;
  }
}

/**
 * Execute a curl command and return its stdout as a string.
 * Uses KHAMSAT_COOKIES when set for authenticated (logged-in) requests.
 */
function curlPost(url, data, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const cookies = getSessionCookies();
    const args = [
      '-s',
      '--max-time', String(Math.floor(REQUEST_TIMEOUT_MS / 1000)),
      '-X', 'POST',
      ...(cookies ? ['-H', `Cookie: ${cookies}`] : ['--cookie-jar', COOKIE_FILE, '--cookie', COOKIE_FILE]),
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

async function probeId(id, overrideUrl = null) {
  const url = overrideUrl
    ? (overrideUrl.startsWith('http') ? overrideUrl : `https://khamsat.com${overrideUrl}`)
    : `https://khamsat.com/community/requests/${id}`;

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
    
    // Navigate and wait for content
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // Give WAF challenge time if it's there
    try {
      await page.waitForSelector('article.replace_urls, h1', { timeout: 10000 });
    } catch (e) {
      // ignore timeout if 404 or something else
    }
    
    const finalUrl = page.url();
    const html = await page.content();
    await page.close();
    
    // Check if redirected away from /community/requests/ (e.g., to /community/stories/)
    if (!finalUrl.includes('/community/requests/')) {
      console.log(`[probe] ID ${id} → IGNORED (redirected to ${finalUrl})`);
      return { status: 'not_found' };
    }
    
    // Check for 404 page content
    if (html.includes('الصفحة المطلوبة غير موجودة') || html.includes('لا يوجد موضوع بهذا الرقم')) {
      console.log(`[probe] ID ${id} → 404/Empty found`);
      return { status: 'not_found' };
    }
    
    // Parse the page
    const post = parsePostPage(html, id, url);
    
    if (!post || !post.title) {
      if (html.includes('مجتمع خمسات') && !html.includes(id)) {
        return { status: 'not_found' };
      }
      return { status: 'not_found' };
    }

    console.log(`[probe] ID ${id} → ✅ FOUND: "${post.title}"`);
    return { status: 'new', post };
    
  } catch (err) {
    console.error(`[probe] ID ${id} → error: ${err.message}`);
    return { status: 'error', error: err.message };
  }
}

/**
 * Quick probe using curl instead of Puppeteer.
 * Fetches the post page and extracts details, user type, comments, and commentsCount.
 */
async function quickProbe(id, postUrl = null) {
  const url = postUrl
    ? (postUrl.startsWith('http') ? postUrl : `https://khamsat.com${postUrl}`)
    : `https://khamsat.com/community/requests/${id}`;

  const cookies = getSessionCookies();
  const args = [
    '-s',
    '--max-time', '20',
    '-L',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ...(cookies ? ['-H', `Cookie: ${cookies}`] : []),
    url
  ];

  return new Promise((resolve) => {
    execFile('curl', args, { timeout: 22000 }, (err, stdout) => {
      if (err || !stdout || stdout.length < 500) {
        return resolve({ status: 'error', error: err ? err.message : 'Empty response' });
      }

      const post = parsePostPage(stdout, id, url);
      if (!post) return resolve({ status: 'not_found' });

      resolve({ status: 'new', post });
    });
  });
}

/**
 * Fetch post page HTML via curl and extract comments count.
 * Uses postUrl from known_posts (e.g. /community/requests/784066).
 * Parses the card: <div data-commentable="true"> ... <h3>التعليقات (31)</h3>
 */
async function fetchCommentsCountFromUrl(postUrl) {
  if (!postUrl) return null;
  const url = postUrl.startsWith('http') ? postUrl : `https://khamsat.com${postUrl}`;

  const cookies = getSessionCookies();
  const args = [
    '-s',
    '--max-time', '20',
    '-L',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    ...(cookies ? ['-H', `Cookie: ${cookies}`] : []),
    url
  ];

  return new Promise((resolve) => {
    execFile('curl', args, { timeout: 22000 }, (err, stdout) => {
      if (err || !stdout || stdout.length < 500) return resolve(null);
      resolve(extractCommentsCountFromHtml(stdout));
    });
  });
}

/**
 * Extract comments count from post page HTML.
 * Expects structure: <div data-commentable="true" data-commentable-type="forum_post"> ... <h3>التعليقات (31)</h3>
 */
function extractCommentsCountFromHtml(html) {
  if (!html || html.length < 200) return null;
  const comments = parseCommentsHtml(html);
  return comments.length;
}

/**
 * Fetch a user's profile and extract their buyer level.
 */
async function probeUserProfile(profileUrl) {
  if (!profileUrl) return null;
  const url = profileUrl.startsWith('http') ? profileUrl : `https://khamsat.com${profileUrl}`;

  const cookies = getSessionCookies();
  const args = [
    '-s',
    '--max-time', '15',
    '-L',
    '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(cookies ? ['-H', `Cookie: ${cookies}`] : []),
    url
  ];

  return new Promise((resolve) => {
    execFile('curl', args, { timeout: 17000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);

      const root = parse(stdout);
      // Look for the label "مستوى المشتري"
      const spans = root.querySelectorAll('.list span');
      let buyerLevel = null;

      for (let i = 0; i < spans.length; i++) {
        if (spans[i].text.includes('مستوى المشتري')) {
          // The next span or sibling list item usually contains the value
          const valueContainer = spans[i].closest('.list').nextElementSibling;
          if (valueContainer) {
            buyerLevel = valueContainer.text.trim();
            break;
          }
        }
      }

      resolve(buyerLevel);
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

  const articleEl = root.querySelector('article.replace_urls') || root.querySelector('article');

  let content = null;
  if (articleEl) {
    let rawHtml = articleEl.innerHTML;
    // Replace <br> with newlines, and <p>/<div> with newlines to preserve structure
    rawHtml = rawHtml.replace(/<br\s*\/?>/gi, '\n');
    rawHtml = rawHtml.replace(/<\/(p|div)>/gi, '\n');
    rawHtml = rawHtml.replace(/<(p|div)[^>]*>/gi, '');

    // Strip remaining HTML tags
    rawHtml = rawHtml.replace(/<[^>]+>/g, '');

    // Decode HTML entities (extended)
    rawHtml = rawHtml.replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // Normalize whitespace but keep newlines
    content = rawHtml.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 || line === '') // keep intentional breaks
      .join('\n')
      .trim();
  }

  const requesterLink = root.querySelector('.details-list a.user') || root.querySelector('a.user') || root.querySelector('a.sidebar_user');
  const requesterAvatar = root.querySelector('.avatar-td img, .user-info img');

  // Extract User Type from current post page
  let userType = null;
  // Strategy A: details-list (found on request pages)
  const detailItems = root.querySelectorAll('ul.details-list li');
  for (const li of detailItems) {
    const icon = li.querySelector('i.fa-user, i.fa.fa-user, i[class*="fa-user"]');
    if (icon) {
      // Get text content, excluding the icon itself
      const text = li.text.trim();
      if (text && !text.includes('مستوى')) { // exclude label if present
        userType = text;
        break;
      }
    }
  }

  // Strategy B: Sidebar list (fallback)
  if (!userType) {
    const spans = root.querySelectorAll('.list span');
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].text.includes('مستوى المشتري')) {
        const valueContainer = spans[i].closest('.list').nextElementSibling;
        if (valueContainer) {
          userType = valueContainer.text.trim();
          break;
        }
      }
    }
  }

  const requester = {
    name: requesterLink ? requesterLink.text.trim() : null,
    profileUrl: requesterLink ? requesterLink.getAttribute('href') : null,
    avatar: requesterAvatar ? requesterAvatar.getAttribute('src') : null,
    userType: userType,
    level: userType // keep level for backward compatibility
  };

  let timeText = '';
  let timeStr = '';
  const timeSpans = root.querySelectorAll('span[title]');
  for (const span of timeSpans) {
    if (span.getAttribute('title')?.includes('GMT')) {
      timeText = span.text.trim().replace(/\s+/g, ' ');
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

  const commentsCount = extractCommentsCountFromHtml(html);
  const comments = parseCommentsHtml(html);

  return {
    id: Number(id),
    idString: String(id),
    postId: `forum_post-${id}`,
    index: 0,
    title,
    postDetails: content, // The newly added content
    postUrl: `/community/requests/${id}`,
    requester,
    userType: userType, // also at top level as requested
    timing,
    lastReplier: null,
    commentsCount, // e.g. 31 from "التعليقات (31)"
    comments, // Added list of actual comments
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
      if (postUrl && postUrl.includes('/community/stories/')) {
        continue; // skip stories
      }

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

/**
 * Submit a comment reply to a post.
 * Uses Khamsat's /discussion/reply endpoint with commentable_type=forum_post.
 */
async function submitComment(postId, content, token, lastId = 0, overrideUrl = null) {
  const referer = overrideUrl
    ? (overrideUrl.startsWith('http') ? overrideUrl : `https://khamsat.com${overrideUrl}`)
    : `https://khamsat.com/community/requests/${postId}`;

  const url = 'https://khamsat.com/community/discussion/reply';
  const data = [
    `content=${encodeURIComponent(content)}`,
    `token=${encodeURIComponent(token)}`,
    'confirm=0',
    `last_id=${lastId}`,
    'commentable_type=forum_post',
    `commentable_id=${postId}`
  ].join('&');

  const hasCookies = !!getSessionCookies();
  console.log(`[comment] POST ${url} (post ${postId}, cookies: ${hasCookies ? 'yes' : 'no'})`);

  try {
    const raw = await curlPost(url, data, [
      '-H', `Referer: ${referer}`,
      '-H', 'Origin: https://khamsat.com'
    ]);
    
    try {
      return JSON.parse(raw);
    } catch (e) {
      const preview = (raw || '').trim().substring(0, 200).replace(/\s+/g, ' ');
      console.error(`[comment] Non-JSON from ${url}. Preview:`, preview);
      let hint = '';
      if (/سجّل دخول|login|تسجيل الدخول/i.test(preview)) {
        hint = ' الجلسة منتهية — حدّث KHAMSAT_COOKIES (rack.session) من المتصفح.';
      } else if (/<html|<!DOCTYPE/i.test(preview)) {
        hint = ' خمسات أعاد HTML بدل JSON — تأكد من صلاحية الكوكي والتوكين.';
      } else {
        hint = ` الاستجابة: "${preview.slice(0, 80)}..."`;
      }
      throw new Error(`استجابة غير صالحة من خمسات.${hint}`);
    }
  } catch (err) {
    console.error(`[comment] Failed for ID ${postId}: ${err.message}`);
    throw err;
  }
}

module.exports = { fetchLatestPosts, probeId, quickProbe, probeUserProfile, parsePostsHtml, submitComment, closeBrowser, fetchCommentsCountFromUrl };
