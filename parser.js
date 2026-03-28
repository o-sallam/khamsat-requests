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
      const idAttr = row.getAttribute('id') || ''; 
      const idNum = Number(idAttr.replace('forum_post-', ''));
      const idString = String(idNum);

      const titleEl = row.querySelector('td.details-td h3.details-head a');
      const title = titleEl ? titleEl.text.trim() : null;
      const postUrl = titleEl ? titleEl.getAttribute('href') : null;

      // Requester (First user link)
      const users = row.querySelectorAll('td.details-td a.user');
      const requesterEl = users[0];
      const requester = {
        name: requesterEl ? requesterEl.text.trim() : null,
        profileUrl: requesterEl ? requesterEl.getAttribute('href') : null,
        avatar: row.querySelector('td.avatar-td img')?.getAttribute('src') || null
      };

      // Last Replier (Second user link if exists)
      const replierEl = users[1];
      const lastReplier = replierEl ? {
        name: replierEl.text.trim(),
        profileUrl: replierEl.getAttribute('href'),
        avatar: null, // Scraper schema has it, but it's often not in the row HTML for the replier
        replyTime: {
          text: '', // To be filled from span
          timestamp: '' // To be filled from span
        }
      } : null;

      // Timing info
      const timeSpans = row.querySelectorAll('td.details-td span[title]');
      const postedSpan = timeSpans[0];
      const activitySpan = timeSpans[1];

      const timing = {
        posted: {
          text: postedSpan ? postedSpan.text.trim() : '',
          timestamp: postedSpan ? postedSpan.getAttribute('title') : ''
        },
        lastReplyMobile: activitySpan ? activitySpan.text.trim() : ''
      };

      if (lastReplier && activitySpan) {
        lastReplier.replyTime.text = activitySpan.text.trim();
        lastReplier.replyTime.timestamp = activitySpan.getAttribute('title');
      }

      posts.push({
        id: idNum,
        idString: idString,
        postId: idAttr,
        index: 0,
        title: title,
        postUrl: postUrl,
        requester: requester,
        timing: timing,
        lastReplier: lastReplier,
        detectedAt: new Date().toISOString()
      });
    } catch (err) {
      console.error(`[parser] Failed to parse row: ${err.message}`);
    }
  }

  return posts;
}

/**
 * Parses the individual post page HTML for comments.
 * Returns an array of clean comment objects.
 */
function parseCommentsHtml(html) {
  const root = parse(html);
  const commentEls = root.querySelectorAll('.discussion-item.comment');
  const comments = [];

  for (const el of commentEls) {
    try {
      const id = el.getAttribute('data-id');
      const userEl = el.querySelector('.meta--user a');
      const dateEl = el.querySelector('.meta--date span');
      const avatarEl = el.querySelector('.meta--avatar img');
      const contentEl = el.querySelector('.discussion-message article.comment.reply_content');

      comments.push({
        id: id,
        user: {
          name: userEl ? userEl.text.replace(/\s+/g, ' ').trim() : null,
          profileUrl: userEl ? userEl.getAttribute('href') : null,
          avatar: avatarEl ? avatarEl.getAttribute('src') : null
        },
        timing: {
          text: dateEl ? dateEl.text.replace(/\s+/g, ' ').trim() : '',
          timestamp: dateEl ? dateEl.getAttribute('title') : ''
        },
        content: contentEl ? contentEl.innerHTML.replace(/\s+/g, ' ').trim() : ''
      });
    } catch (err) {
      console.error(`[parser] Failed to parse comment: ${err.message}`);
    }
  }

  return comments;
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

module.exports = { parsePostsHtml, parseCommentsHtml };
