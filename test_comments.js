const fs = require('fs');
const path = require('path');
const { parseCommentsHtml } = require('./parser');

function testCommentParsing() {
  const htmlPath = path.join(__dirname, 'o.html');
  if (!fs.existsSync(htmlPath)) {
    console.error('o.html not found');
    return;
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const comments = parseCommentsHtml(html);

  console.log(`Found ${comments.length} comments.`);
  if (comments.length > 0) {
    console.log('First comment:', JSON.stringify(comments[0], null, 2));
  } else {
    console.log('No comments found. Check selectors in parseCommentsHtml.');
  }
}

testCommentParsing();
