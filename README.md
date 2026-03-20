# Khamsat Monitor

Real-time monitor for Khamsat.com community requests. Polls every 2 minutes and exposes new posts as clean JSON via REST API.

---

## Setup

```bash
npm install
npm start
# or for dev with auto-reload:
npm run dev
```

Server starts on `http://localhost:3000`

---

## Phase 1 — Seed from your scraped data

Before monitoring starts, seed the system with your scraped posts so old posts are never treated as new.

### Option A — Full post objects (recommended)
Use this if you have a full scrape file (with titles, avatars, timestamps, etc).
The endpoint accepts your scraper's exact output format directly.

```bash
curl -X POST http://localhost:3000/seed/full \
  -H "Content-Type: application/json" \
  -d @your_scrape_file.json
```

Your scrape file can be either shape:
```json
{ "totalPosts": 1065, "posts": [ ... ] }
```
or just a plain array:
```json
[ { "id": 783998, "title": "...", ... } ]
```

Response:
```json
{
  "ok": true,
  "received": 1065,
  "added": 1065,
  "skipped": 0,
  "message": "1065 posts added. 0 skipped (already known or missing ID)."
}
```

### Option B — IDs only (lightweight)
Use this if you only have a list of IDs and no metadata.

```bash
curl -X POST http://localhost:3000/seed \
  -H "Content-Type: application/json" \
  -d '{ "ids": [783998, 783997, 783995, 783945] }'
```

Response:
```json
{
  "ok": true,
  "received": 4,
  "added": 4,
  "message": "4 new IDs added to known set. 0 were already known."
}
```

---

## REST Endpoints

### `GET /status`
Poller health check — known IDs count, last poll time, buffer size.

```json
{
  "ok": true,
  "knownIdsCount": 1065,
  "allPostsCount": 1065,
  "newPostsBufferCount": 3,
  "lastPollAt": "2026-03-20T10:00:00.000Z",
  "lastPollStatus": "ok",
  "pollCount": 5,
  "pollIntervalMs": 120000
}
```

---

### `GET /posts/new`
Returns posts detected **since the last time you called this endpoint**, then clears the buffer.
Call this repeatedly (e.g. every 30s from your client) to consume new arrivals.

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

---

### `GET /posts/recent?limit=20`
Returns the N most recently **published** posts, sorted by post creation time (newest first).
This is different from Khamsat's default ordering which sorts by last freelancer activity.

```
GET /posts/recent         → top 20 by publish time
GET /posts/recent?limit=50 → top 50
```

```json
{
  "count": 20,
  "sortedBy": "postedAt (newest first)",
  "posts": [ ... ]
}
```

---

### `GET /posts/all?limit=25&offset=0`
Returns all posts ever seen. Supports pagination via `limit` and `offset`.

```
GET /posts/all              → all posts
GET /posts/all?limit=25     → first 25
GET /posts/all?limit=25&offset=25  → next 25
```

---

### `POST /seed/full`
Seed from full scraped post objects. Normalizes your scraper's field names automatically.
Body: `{ "posts": [...] }` or the full scrape file shape `{ "totalPosts": N, "posts": [...] }`

---

### `POST /seed`
Seed with IDs only (no metadata stored).
Body: `{ "ids": [783998, 783997, ...] }`

---

### `POST /poll/now`
Manually trigger an immediate poll cycle (useful for testing without waiting 2 minutes).

---

## Post Object Schema

| Field | Type | Description |
|---|---|---|
| `postId` | string | Khamsat post ID |
| `title` | string | Arabic title of the request |
| `postUrl` | string | Full URL to the post |
| `buyer.name` | string | Display name of requester |
| `buyer.profileUrl` | string | Full profile URL |
| `buyer.avatar` | string | Avatar image URL |
| `postedAt.iso` | string | ISO 8601 post creation time |
| `postedAt.relative` | string | Arabic relative time e.g. "منذ يوم" |
| `lastActivity.iso` | string | ISO 8601 last freelancer activity time |
| `lastActivity.relative` | string | Arabic relative time |
| `detectedAt` | string | When this system first detected the post |
| `seededFromScrape` | boolean | `true` if loaded via `/seed/full`, absent if found by poller |

---

## Data Files

| File | Description |
|---|---|
| `data/known_ids.json` | All post IDs the system has seen — persists across restarts |
| `data/known_posts.json` | Full post objects — persists across restarts |

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express server port |
| `POLL_INTERVAL_MS` | `120000` | Poll frequency in ms (120000 = 2 min) |
| `KHAMSAT_URL` | Khamsat AJAX endpoint | Target URL |

---

## Upgrading to WebSocket (future)

When ready, install `socket.io` and add two lines to `poller.js`:

```js
// After detecting freshPosts in poll():
if (freshPosts.length > 0) {
  io.emit('new_posts', freshPosts);
}
```

Clients then connect via `socket.on('new_posts', handler)` for instant push instead of polling `/posts/new`.
