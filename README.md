# Khamsat Monitor

Real-time monitor for Khamsat.com community requests. Polls every 2 minutes and exposes new posts as clean JSON via REST API.

## Setup

```bash
pnpm install
pnpm start
# or for dev with auto-reload:
pnpm run dev
```

Server starts on `http://localhost:3000`

---

## Phase 1 — Seed your known IDs (manual scrape)

Before monitoring starts catching new posts, you need to seed the system with all the post IDs you've already scraped. This prevents the first poll from treating old posts as "new".

```bash
curl -X POST http://localhost:3000/seed \
  -H "Content-Type: application/json" \
  -d '{ "ids": [783998, 783995, 783254, 783945, 783893, 783726, 783997] }'
```

Response:
```json
{
  "ok": true,
  "received": 7,
  "added": 7,
  "message": "7 new IDs added to known set. 0 were already known."
}
```

---

## REST Endpoints

### `GET /status`
Health check — poller state, counts, last poll time.

```json
{
  "ok": true,
  "knownIdsCount": 250,
  "allPostsCount": 120,
  "newPostsBufferCount": 3,
  "lastPollAt": "2026-03-20T10:00:00.000Z",
  "lastPollStatus": "ok",
  "pollCount": 5,
  "pollIntervalMs": 120000
}
```

### `GET /posts/new`
Returns posts detected **since the last time you called this endpoint**. Drains the buffer.

```json
{
  "count": 2,
  "posts": [
    {
      "postId": "784010",
      "title": "تصميم شعار احترافي",
      "postUrl": "https://khamsat.com/community/requests/784010-...",
      "buyer": {
        "name": "أحمد م.",
        "profileUrl": "https://khamsat.com/user/ahmed_m",
        "avatar": "https://avatars.hsoubcdn.com/..."
      },
      "postedAt": {
        "iso": "2026-03-20T10:34:53.000Z",
        "relative": "منذ 5 دقائق"
      },
      "lastActivity": {
        "iso": "2026-03-20T10:34:53.000Z",
        "relative": "آخر تفاعل منذ 5 دقائق"
      },
      "detectedAt": "2026-03-20T10:36:00.000Z"
    }
  ]
}
```

### `GET /posts/all?limit=25&offset=0`
All posts ever seen. Supports pagination.

### `POST /seed`
Bulk-load post IDs from manual scraping.
Body: `{ "ids": [783998, 783995, ...] }`

### `POST /poll/now`
Trigger an immediate poll (for testing).

---

## Post Object Schema

| Field | Type | Description |
|---|---|---|
| `postId` | string | Khamsat post ID |
| `title` | string | Arabic title of the request |
| `postUrl` | string | Full URL to the post |
| `buyer.name` | string | Display name of requester |
| `buyer.profileUrl` | string | Profile URL |
| `buyer.avatar` | string | Avatar image URL |
| `postedAt.iso` | string | ISO 8601 post creation time |
| `postedAt.relative` | string | Arabic relative time ("منذ يوم") |
| `lastActivity.iso` | string | ISO 8601 last activity time |
| `lastActivity.relative` | string | Arabic relative time |
| `detectedAt` | string | When our system first saw this post |

---

## Upgrading to WebSocket (future)

When ready, add `socket.io` and emit on new posts:
```js
// in poller.js, after detecting freshPosts:
io.emit('new_posts', freshPosts);
```
