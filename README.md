# JobGuard

[![CI](https://github.com/tony-tran-qa/My_JobGuard_ChromeExt/actions/workflows/lint.yml/badge.svg)](https://github.com/tony-tran-qa/My_JobGuard_ChromeExt/actions/workflows/lint.yml)
![Manifest](https://img.shields.io/badge/Manifest-v3-blue)
![Chrome](https://img.shields.io/badge/Chrome-Extension-yellow?logo=googlechrome)
![License](https://img.shields.io/badge/License-MIT-green)

**In-page job vetting for LinkedIn: Chrome Extension (Manifest V3)**

JobGuard checks companies as you browse LinkedIn. It flags blacklisted companies automatically and vets any posting with one click using the Anthropic API. Results are a screening aid, not a verdict.

> This extension is the lightweight, in-page tool. For the full workspace (records, favorites, agencies and IT-consulting firm types, per-tab JSON export and import, folder backup) see the companion web app: [My_JobGuard_ReactApp](https://github.com/tony-tran-qa/My_JobGuard_ReactApp). UI tests for the web app are in [My_JobGuard_TestWithRobotAndPlaywright](https://github.com/tony-tran-qa/My_JobGuard_TestWithRobotAndPlaywright).

---

## Demo

| Auto-scan badges | Sidebar vet panel | Blacklist banner |
|---|---|---|
| `⬡ VET` and `🚫 BLACKLISTED` badges inject next to company names in job search results | Slide-out panel shows risk level, red/green flags, and verification steps | Full-page red banner on blacklisted company detail pages |

---

## Features

| Feature | Details |
|---|---|
| 🤖 AI vetting | Claude API returns risk level (LOW/MEDIUM/HIGH), red flags, green flags, verification steps, and APPLY/CAUTION/AVOID recommendation |
| 🚫 Personal blacklist | Persists in Chrome local storage across all sessions |
| ⚡ Instant checks | Blacklist hits require zero API calls |
| 💾 Result caching | Repeated lookups for the same company skip the API (100-entry LRU) |
| 🖱️ Right-click menu | Vet or blacklist any selected text from anywhere on the page |
| 🔄 SPA navigation | MutationObserver re-scans on LinkedIn's client-side route changes |
| 🏢 Agencies | Staffing and IT consulting firms are tagged automatically when a vet identifies one (the AI is asked for an explicit firm type), or add them by hand; Scan Records finds ones you vetted earlier |
| 🧾 Records and favorites | Every vet is saved as a record you can star, expand or delete; same record format as the web app |
| 💾 Backup and restore | Export or import blacklist, records and favorites as one JSON file shared with the JobGuard web app (merge only, nothing is deleted) |
| 🪟 Full-tab view | The popup is 680px wide; the Full tab button opens the same UI in a browser tab |
| 🔑 Key managed locally | API key stored in Chrome local storage — never leaves your machine |

---

## Installation

### Requirements
- Google Chrome (or Chromium-based browser)
- Anthropic API key — get one at [console.anthropic.com](https://console.anthropic.com)

### Load the extension (developer mode)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `jobguard-extension` folder
5. The JobGuard icon appears in your toolbar

### Add your API key

1. Click the JobGuard toolbar icon
2. Open the **Settings** tab
3. Paste your `sk-ant-...` key → **Save Key**

Your key is stored locally — it is never transmitted anywhere except directly to `api.anthropic.com`.

---

## Usage

### Job search results
Browse LinkedIn jobs as normal. JobGuard auto-injects badges next to every company name:
- `⬡ VET` — click to open the sidebar vet panel
- `🚫 BLACKLISTED` — company is in your blacklist; card is outlined in red

### Job detail pages & company pages
A **⬡ JobGuard Vet** button appears near the Apply button. Blacklisted companies trigger a dismissable red banner at the top of the page.

### Right-click anywhere
Highlight any company name → right-click → **Vet this company with JobGuard** or **Add to JobGuard Blacklist**.

### Extension popup
Click the toolbar icon to manually vet any company, browse saved records and favorites, keep a list of staffing and IT consulting firms, manage your blacklist, export or import a backup, or update your API key. Use **Full tab** (top right) for a full-size view.

---

## Architecture

```
jobguard-extension/
├── lib/
│   ├── jobguard-core.js   Pure logic — checkBlacklist, parseVetResult, buildCacheKey, isCacheExpired
│   └── jobguard-data.js   Records, favorites and backup helpers (shared backup format with the web app)
├── tests/
│   ├── jobguard.test.js        Jest unit tests for jobguard-core (29 cases)
│   └── jobguard-data.test.js   Jest unit tests for jobguard-data (34 cases)
├── manifest.json          MV3 config — permissions, host_permissions, service worker
├── background.js          Service worker — Anthropic API calls, cache, context menus, message bus
├── content.js             LinkedIn scanner — DOM injection, badge/sidebar/banner rendering
├── content.css            Styles for all injected UI elements
├── popup.html             Toolbar popup — 6-tab layout, same order as the web app (Vet / Records / Favorites / Agencies / Blacklist / Settings)
├── popup.js               Popup logic — blacklist CRUD, records, favorites, agencies, backup, API key, result rendering
├── jest.config.js         Jest configuration
└── icons/                 16 / 48 / 128px PNG icons
```

**Message flow:**

```
content.js / popup.js  →  chrome.runtime.sendMessage  →  background.js
                                                              ↓
                                                     api.anthropic.com/v1/messages
                                                              ↓
                                                     chrome.storage.local (cache)
                                                              ↓
                                                     sendResponse → UI render
```

---

## Testing

```bash
npm test              # run Jest unit tests
npm run test:coverage # run with coverage report
npm run lint          # ESLint across all JS files
```

### What is tested

Jest unit tests cover the pure logic layer in `lib/jobguard-core.js` and `lib/jobguard-data.js`:

| Function | Cases | What's covered |
|---|---|---|
| `checkBlacklist` | 10 | Exact match, case-insensitive, bidirectional substring, empty list, null inputs, whitespace trimming |
| `buildCacheKey` | 5 | Normalisation, default role, key uniqueness |
| `parseVetResult` | 9 | Valid results, all enum values, invalid inputs, missing fields, array defaulting |
| `isCacheExpired` | 5 | TTL boundary conditions, fresh vs stale, injectable clock |
| `buildBackup`, `parseImport`, `applyImport` | 9 | Round trip, web-app backup accepted, plain blacklist array accepted, bad files rejected, merge never deletes |
| `mergeByName`, `mergeById`, `cleanBlacklist`, `cleanAgencies`, `cleanEntries` | 9 | Case-insensitive dedupe, id dedupe, normalisation of imported entries |
| `buildRecord`, `upsertRecord`, `toggleFavorite` | 9 |
| `inferOrgType`, `addAgencyIfNew`, `scanRecordsForAgencies` | 7 | Explicit orgType wins, keyword fallback, duplicate and invalid names skipped, scan counts additions | Record shape matches the web app, same company and role updates in place, favorite toggle |

### What is not tested (and why)

Chrome extension unit testing requires more scaffolding than a plain Node.js project. The `chrome.*` APIs — `chrome.storage`, `chrome.runtime.sendMessage`, `chrome.contextMenus` — don't exist in Node. The standard solution is:

- **`jest-chrome`** — mocks the entire `chrome.*` namespace so tests can call storage and runtime APIs without a real browser
- **`testEnvironment: "jsdom"`** — gives Jest a browser-like DOM so `document`, `window`, and `fetch` are available

This project uses the extraction pattern: all testable pure logic lives in `lib/jobguard-core.js` with zero `chrome.*` dependencies, so the current test suite runs cleanly in Node without any browser mock.

> **Note:** `jest-chrome` is intentionally absent from `devDependencies`. As of April 2026, `jest-chrome@0.8.0` declares a peer dependency on Jest 26/27 and is incompatible with Jest 29. It will be added back once a compatible version is published upstream.

The following paths are verified by loading the extension in Chrome directly (manual / exploratory):
- `chrome.storage` read/write lifecycle
- `chrome.runtime.sendMessage` flows between content ↔ background ↔ popup
- DOM badge and sidebar injection on live LinkedIn pages

---

## Privacy

- Blacklist, records, favorites and API key live in `chrome.storage.local` on your machine only
- Company names are sent to `api.anthropic.com` only when you explicitly click Vet
- No analytics, no tracking, no external services beyond Anthropic

---

## License

MIT © Tony Tran
