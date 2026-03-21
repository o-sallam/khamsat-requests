# Khamsat Monitor 🚀

Real-time, high-fidelity monitoring for Khamsat.com community requests. This version features an advanced **Hybrid Polling Engine** and a **Premium Live Dashboard** with deep article scraping.

---

## ⚡ New & Advanced Features

### 🔍 Hybrid Polling & Predictive Probing
The monitor combines the speed of the official AJAX feed with a proactive **Predictive ID Engine**:
- **AJAX Discovery**: Quickly catches bulk updates from the main community feed.
- **Predictive Proving**: Continually checks future IDs (+1, +2, +3) ahead of the current maximum strictly after each poll. This allows discovery of new posts **before** they even appear on the main Khamsat landing page.
- **Automatic Upgrading**: If a post is first discovered as a "stub" (protected by JS challenges), the system automatically "upgrades" the data with full title, requester, and timing info as soon as it becomes available.

### 📄 Full Article Scraping
Unlike basic monitors, this system doesn't just show titles. It performs a deeper scrape to extract the **full article content** (`postDetails`).
- **Formatting Preservation**: Maintains line breaks and paragraph structures for easy reading.
- **Local Cache**: All content is stored locally in `known_posts.json` for instant access.

### 🎨 Premium UI Dashboard
A completely redesigned local dashboard at `http://localhost:3000/`:
- **Cairo Typography**: Optimized Arabic font for modern high-resolution displays.
- **Floating Sidebar Panel**: A fixed, glassmorphism-style sidebar showing real-time system metrics (Total IDs, Cache size, Poll cycles).
- **Interactive Tooltips**: Animated custom tooltips for all sidebar metrics.
- **Detail Drawers**: Post rows are now expandable (Accordion style). Click a row to read the full description without leaving the page.
- **Glassmorphism Design**: High-end visual aesthetic with backdrop blurs, subtle highlights, and smooth transitions.

### 🛡️ Resilience & Bot-Protection
- **Dynamic Throttling**: Every scrape request includes a randomized jitter delay (2–5 seconds) to mimic human browsing and prevent IP blocking.
- **Smart 404 Detection**: Intelligent filtering of Arabic "Page Not Found" responses to prevent phatom ID tracking.
- **JS-Challenge Resilience**: Robust handling of Hsoub's protection layers.

---

## 🛠️ Setup

```bash
pnpm install
pnpm start
# or for development:
pnpm run dev
```

Dashboard: `http://localhost:3000/`

---

## 📊 REST API Endpoints

### `GET /status`
System health, connection status, and polling statistics.

### `GET /posts/new`
Returns newly detected posts since the last call and clears the internal buffer.

### `GET /posts/all`
Returns the entire historical database of scraped requests.

---

## 🏗️ Technical Architecture

- **Probe Engine (`probe.js`)**: Handles raw HTML fetching via `curl`, cookie/header management, and robust HTML parsing using `node-html-parser`.
- **Coordinator (`poller.js`)**: Manages the polling loop, predictive probing logic, and state synchronization between memory and disk.
- **Storage (`store.js`)**: Handles atomic JSON persistence for `known_ids.json` and `known_posts.json`.
- **Frontend (`src/`)**: A pure vanilla JS/CSS/HTML implementation for maximum performance and visual control.

---

## ⚖️ License
MIT - For educational and professional monitoring purposes.
