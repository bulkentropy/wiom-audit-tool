# Wiom Netbox Physical Verification Tool — Progress Log
**Project:** Prompt Wars 2, Problem #1
**Repo:** https://github.com/bulkentropy/wiom-audit-tool
**Last updated:** 2026-03-18

---

## Status: In Progress — Core build complete, deploying to Render

---

## What Was Built

### Backend (`/backend`)
| File | Status | Description |
|---|---|---|
| `mockDataGen.js` | ✅ Done | Generates 99 devices across 5 partners with pre-designed scenarios |
| `csvLoader.js` | ✅ Done | Loads all CSVs into in-memory Maps at startup |
| `reconcile.js` | ✅ Done | Computes expected accountability list per partner |
| `stateCorrector.js` | ✅ Done | Resolves grey-zone devices (5 resolution categories) |
| `server.js` | ✅ Done | Express app — 20+ API routes, session auth, CSV reports |

### Frontend (`/frontend`)
| File | Status | Description |
|---|---|---|
| `ops/login.html` | ✅ Done | Ops login (admin / wiom@2026) |
| `ops/index.html` | ✅ Done | Home — dataset info + partner credentials table |
| `ops/dashboard.html` | ✅ Done | Live reconciliation dashboard, auto-refreshes every 15s |
| `ops/partner-detail.html` | ✅ Done | Per-partner device-level breakdown + state corrections |
| `partner/login.html` | ✅ Done | Partner login with on-screen PIN keypad (mobile) |
| `partner/welcome.html` | ✅ Done | Welcome screen with device count + 4-step instructions |
| `partner/audit.html` | ✅ Done | Live scan/checklist with ZXing barcode camera + manual entry |
| `partner/complete.html` | ✅ Done | Summary + submit screen |
| `css/ops.css` | ✅ Done | Desktop-first ops theme |
| `css/partner.css` | ✅ Done | Mobile-first partner theme with large touch targets |

### Data (`/data`)
| File | Status |
|---|---|
| `dispatch.csv` | ✅ Generated (99 rows) |
| `device_states.csv` | ✅ Generated (99 rows) |
| `pickup_tickets.csv` | ✅ Generated (13 rows) |
| `partners.csv` | ✅ Generated (5 rows) |

### Deployment
| Item | Status |
|---|---|
| `render.yaml` | ✅ Done |
| GitHub repo pushed | ✅ Done — https://github.com/bulkentropy/wiom-audit-tool |
| Render deployment | 🔄 In progress — connect repo on render.com |

---

## Partner Scenarios (Demo Data)

| Partner | Username / PIN | Scenario |
|---|---|---|
| Rajesh Telecom (Delhi) | partner_rajesh / 1234 | Clean — all expected devices present |
| Sunita Networks (Mumbai) | partner_sunita / 2345 | 3 missing + 2 grey zone (expired tickets) |
| KP Enterprises (Bangalore) | partner_kp / 3456 | 1 unauthorized device (from another partner's dispatch) |
| Mehta Connect (Hyderabad) | partner_mehta / 4567 | Mix of all categories |
| Sharma Fibernet (Pune) | partner_sharma / 5678 | Partial audit (in-progress state demo) |

---

## Bugs Fixed

### Bug 1 — `/ops` and `/partner` not loading (redirect loop)
- **Root cause:** `express.static` intercepted `/ops` as a directory and redirected to `/ops/` which served `index.html` (home) instead of `login.html`
- **Fix:** Moved HTML route declarations before `express.static`, added `{ redirect: false }` to static middleware
- **Commit:** `dd00f21`

### Bug 2 — "Could not load data" + continuous page refresh on ops home
- **Root cause:** `fetch('/api/ops/me')` and `fetch('/api/ops/summary')` fired in parallel. When session expired, both failed simultaneously — summary showed "Could not load data", auth check triggered redirect, redirect landed on home again → loop
- **Fix:** Made auth check `await`-sequential; data only fetches after auth confirmed valid. Applied to all three ops pages.
- **Commit:** `ab0fe00`

---

## Known Limitations / TODO

- [ ] **Render deployment** — complete the render.com web service setup (repo is pushed and ready)
- [ ] **Barcode scanning on iOS** — ZXing camera access requires HTTPS; works on Render deploy, not on HTTP localhost for iOS Safari
- [ ] **Session persistence** — sessions are in-memory; server restart clears all sessions (acceptable for demo, not production)
- [ ] **Upload mode** — ops home has UI for CSV upload but backend multer route is not wired (demo mode works fine)
- [ ] **Sharma Fibernet in-progress state** — currently starts as `not_started`; to demo in-progress, manually scan some devices then don't submit

---

## Local Dev

```bash
cd C:\Users\ajink\wiom-audit-tool

# Ports 3000 and 3001 are occupied by other apps on this machine
PORT=4000 node backend/server.js

# Regenerate mock data (resets all device data)
node backend/mockDataGen.js
```

**URLs:**
- Ops portal: http://localhost:4000/ops
- Partner portal: http://localhost:4000/partner

---

## API Reference (Quick)

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/ops/login` | — | `{ username, password }` |
| `GET /api/ops/summary` | ops | All partners + audit status |
| `GET /api/ops/partner/:id` | ops | Device-level detail for one partner |
| `GET /api/ops/report/full` | ops | Full reconciliation CSV download |
| `GET /api/ops/report/corrections` | ops | State corrections CSV download |
| `GET /api/ops/report/missing` | ops | Missing devices CSV download |
| `POST /api/partner/login` | — | `{ username, pin }` |
| `GET /api/partner/expected` | partner | Expected device list for logged-in partner |
| `POST /api/partner/scan` | partner | `{ device_id }` — scan a device |
| `POST /api/partner/submit` | partner | Lock and submit audit |
| `GET /api/partner/summary` | partner | Verified / missing / unexpected counts |
