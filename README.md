# Khamsat Monitor

Real-time monitor for Khamsat.com community requests. Polls every 5 minutes using a **direct ID-probing algorithm** and exposes new posts as clean JSON via REST API.

---

## How It Works — Direct ID Probing

Instead of relying on the AJAX endpoint, the monitor uses an intelligent **sequential ID probe** strategy:

1. **Find max saved ID**: e.g. `783998`
2. **Probe `783999`, `784000`, `784001`…** via direct GET requests to `https://khamsat.com/community/requests/{id}`
3. **Three possible responses per probe**:
   - ✅ **200 valid page** → new post found, saved immediately
   - 🔄 **Redirect** → post doesn't exist (skip)
   - ❌ **404 HTML page** (`غير موجودة`) → post doesn't exist (skip)
4. **Stop** after 5 consecutive misses (no IDs wasted, no false positives)

This approach is **more reliable** than the AJAX endpoint — you know exactly which IDs are real.

---

## Setup

```bash
pnpm install
pnpm start
# or for dev with auto-reload:
pnpm run dev
```

Server starts on `http://localhost:3000`

📊 **Web Dashboard**: Access the live monitor dashboard at `http://localhost:3000/` to visualize current status and new requests in real-time.

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

### Option B — IDs only (lightweight)
Use this if you only have a list of IDs and no metadata.

```bash
curl -X POST http://localhost:3000/seed \
  -H "Content-Type: application/json" \
  -d '{ "ids": [783998, 783997, 783995, 783945] }'
```

---

## REST Endpoints

### `GET /status`
Poller health check — known IDs count, last poll time, buffer size, current max ID, algorithm in use.

```json
{
  "ok": true,
  "knownIdsCount": 1822,
  "allPostsCount": 1822,
  "newPostsBufferCount": 2,
  "maxKnownId": 784010,
  "lastPollAt": "2026-03-20T10:00:00.000Z",
  "lastPollStatus": "ok",
  "pollCount": 5,
  "pollIntervalMs": 300000,
  "algorithm": "direct-probe"
}
```

---

### `GET /posts/new`
Returns posts detected **since the last time you called this endpoint**, then clears the buffer.
Posts are returned sorted by ID descending (newest first).

```json
{
  "count": 2,
  "posts": [
    {
      "id": 784012,
      "idString": "784012",
      "postId": "forum_post-784012",
      "title": "تصميم شعار احترافي",
      "postUrl": "/community/requests/784012",
      "requester": {
        "name": "أحمد م.",
        "profileUrl": "/user/ahmed_m",
        "avatar": "https://avatars.hsoubcdn.com/..."
      },
      "timing": {
        "posted": { "text": "منذ 5 دقائق", "timestamp": "20/03/2026 10:34:53 GMT" },
        "lastReplyMobile": ""
      },
      "detectedAt": "2026-03-20T10:36:00.000Z",
      "discoveredVia": "probe"
    }
  ]
}
```

---

### `GET /posts/recent?limit=20`
Returns the N most recent posts sorted by numeric ID (newest first).

```
GET /posts/recent          → top 20 by ID
GET /posts/recent?limit=50 → top 50
```

---

### `GET /posts/all?limit=25&offset=0`
Returns all posts ever seen. Supports pagination. Sorted by ID descending (newest first).

```
GET /posts/all               → all posts
GET /posts/all?limit=25      → first 25
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
Manually trigger an immediate poll cycle (useful for testing without waiting 5 minutes).

---

## Post Object Schema

| Field | Type | Description |
|---|---|---|
| `id` | number | Numeric Khamsat post ID |
| `idString` | string | Same ID as string |
| `postId` | string | Full `forum_post-{id}` attribute |
| `title` | string | Arabic title of the request |
| `postUrl` | string | Relative URL to the post |
| `requester.name` | string | Display name of requester |
| `requester.profileUrl` | string | Profile URL |
| `requester.avatar` | string | Avatar image URL |
| `timing.posted.text` | string | Arabic relative time e.g. "منذ يوم" |
| `timing.posted.timestamp` | string | Raw timestamp string |
| `lastReplier` | object or null | Last replier info if available |
| `detectedAt` | string | ISO 8601 when this system first detected the post |
| `discoveredVia` | string | `"probe"` (live discovery) or absent (seeded) |
| `seededFromScrape` | boolean | `true` if loaded via `/seed/full` |

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
| `POLL_INTERVAL_MS` | `300000` | Poll frequency in ms (300000 = 5 min) |

---

## Probe Configuration

Inside `poller.js`, the `probeFromId()` call accepts:

| Option | Default | Description |
|---|---|---|
| `maxConsecutiveMisses` | `5` | Stop after this many consecutive missing IDs |
| `delayMs` | `800` | Delay in ms between each HTTP probe (be polite!) |

---

## Upgrading to WebSocket (future)

When ready, install `socket.io` and add to `poller.js`:

```js
// After detecting freshPosts in poll():
if (freshPosts.length > 0) {
  io.emit('new_posts', freshPosts);
}
```
