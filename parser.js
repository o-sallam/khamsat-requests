const { parse } = require('node-html-parser');

/**
 * Parses the raw HTML string returned by Khamsat's load_more endpoint.
 * Returns an array of clean post objects.
 */
function parsePostsHtml(html) {
  const root = parse(html);
  const rows = root.querySelectorAll('tr.forum_post');
  const posts = [];

  for (const row of rows) {
    try {
      // --- Post ID ---
      const idAttr = row.getAttribute('id') || ''; // e.g. "forum_post-783918"
      const postId = idAttr.replace('forum_post-', '').trim();

      // --- Title & URL ---
      const titleEl = row.querySelector('td.details-td h3.details-head a');
      const title = titleEl ? titleEl.text.trim() : null;
      const relativeUrl = titleEl ? titleEl.getAttribute('href') : null;
      const postUrl = relativeUrl ? `https://khamsat.com${relativeUrl}` : null;

      // --- Buyer (requester) info ---
      const buyerLinkEl = row.querySelector('td.details-td ul.details-list li a.user');
      const buyerName = buyerLinkEl ? buyerLinkEl.text.replace(/\s+/g, ' ').trim() : null;
      const buyerRelUrl = buyerLinkEl ? buyerLinkEl.getAttribute('href') : null;
      const buyerProfileUrl = buyerRelUrl ? `https://khamsat.com${buyerRelUrl}` : null;

      // Avatar is in the first <td> (avatar-td)
      const avatarEl = row.querySelector('td.avatar-td img');
      const buyerAvatar = avatarEl ? avatarEl.getAttribute('src') : null;

      // --- Posted time ---
      // The d-lg-inline-block li contains a <span> with the title attr = ISO time
      const postedTimeEl = row.querySelector('td.details-td li.d-lg-inline-block span');
      const postedTimeISO = postedTimeEl ? postedTimeEl.getAttribute('title') : null;
      const postedTimeRelative = postedTimeEl ? postedTimeEl.text.trim() : null;

      // --- Last activity time ---
      // The d-lg-none li contains the last interaction span
      const lastActEl = row.querySelector('td.details-td li.d-lg-none span');
      const lastActISO = lastActEl ? lastActEl.getAttribute('title') : null;
      const lastActRelative = lastActEl ? lastActEl.text.replace(/\s+/g, ' ').trim() : null;

      posts.push({
        postId,
        title,
        postUrl,
        buyer: {
          name: buyerName,
          profileUrl: buyerProfileUrl,
          avatar: buyerAvatar,
        },
        postedAt: {
          iso: postedTimeISO ? parseKhamsatDate(postedTimeISO) : null,
          relative: postedTimeRelative,
        },
        lastActivity: {
          iso: lastActISO ? parseKhamsatDate(lastActISO) : null,
          relative: lastActRelative,
        },
        detectedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[parser] Failed to parse row: ${err.message}`);
    }
  }

  return posts;
}

/**
 * Khamsat date format: "DD/MM/YYYY HH:MM:SS GMT"
 * Converts to ISO 8601 string.
 */
function parseKhamsatDate(raw) {
  try {
    // e.g. "18/03/2026 13:34:53 GMT"
    const [datePart, timePart] = raw.trim().split(' ');
    const [day, month, year] = datePart.split('/');
    return new Date(`${year}-${month}-${day}T${timePart}Z`).toISOString();
  } catch {
    return raw; // return raw string if parsing fails
  }
}

module.exports = { parsePostsHtml };
