# Copilot Usage Monitor

A Chrome extension (Manifest V3) that displays your **GitHub Copilot premium request usage** — quota consumed vs. monthly allowance — directly in your browser toolbar.

---

## Features

- 🔢 **Live badge** showing requests used, color-coded by consumption level
- 📊 **Popup** with progress bar, used/allowance numbers, days until reset, and last-updated timestamp
- ⚙️ **Options page** for PAT management, plan selection, and poll interval
- 🔄 **Automatic polling** every 15/30/60 minutes using `chrome.alarms` (MV3-compliant)
- 🔒 **Secure token storage** in `chrome.storage.local`, never logged or sent anywhere except `api.github.com`

---

## Setup

### 1. Create a GitHub Personal Access Token

1. Go to **GitHub → Settings → Developer Settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Give it a descriptive name (e.g. `Copilot Usage Monitor`)
4. Select scope: **`manage_billing:copilot`**
5. Click **Generate token** and copy it immediately

> **Or** use this pre-filled link:
> https://github.com/settings/tokens/new?scopes=manage_billing:copilot&description=Copilot+Usage+Monitor

### 2. Install the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this folder

### 3. Configure the extension

1. Click the **⚙ Settings** button in the popup (or right-click the extension icon → Options)
2. Paste your PAT
3. Click **Test Connection** — you should see `✓ Authenticated as your-username`
4. Optionally select your Copilot plan manually (or leave on Auto-detect)
5. Click **Save Settings**

The badge and popup will update within a few seconds.

---

## Badge Colors

| Color | Meaning |
|---|---|
| 🟢 Green | 0–49% of monthly allowance used |
| 🟡 Yellow | 50–79% used |
| 🟠 Orange | 80–99% used |
| 🔴 Red | 100%+ used (quota exhausted) |
| ⚫ Grey (`—`) | No token configured |
| 🔴 Red (`ERR`) | API error or invalid token |

---

## Plan Allowances (2025)

| Plan | Monthly Premium Requests |
|---|---|
| Copilot Pro | 300 |
| Copilot Business | 300 per user |
| Copilot Enterprise | 1,000 per user |
| Copilot Pro+ | 1,500 |

> **Note:** GitHub is transitioning Pro+ to an AI Credits model in 2026. Allowance numbers may change. Update `shared/constants.js` → `PLAN_ALLOWANCES` when they do.

---

## Known Limitations

1. **Org/enterprise-managed licenses**: This extension uses user-level billing API endpoints that only work when you pay for Copilot directly on your personal account. If your license is managed by an organization or enterprise (even if you have a personal seat), the API will return empty data or a 403. The popup will display a warning banner in this case.

2. **Reset date**: The billing cycle reset date is approximated as the 1st of next month. If your billing cycle starts on a different day, the countdown may be slightly off.

3. **Pro+ credit migration**: Pro+ is moving from request-based to an AI Credits model. A future v2 will add support for the `/ai_credit/usage` endpoint.

4. **Fine-grained PATs**: Fine-grained PATs are not confirmed to work with the billing endpoints. Use a classic PAT with `manage_billing:copilot` scope.

---

## Architecture

```
copilot-usage-monitor/
├── manifest.json                  # MV3 manifest
├── background/
│   └── service-worker.js          # Alarm-driven polling + badge updates
├── popup/
│   ├── popup.html / .js / .css    # Toolbar popup UI
├── options/
│   ├── options.html / .js / .css  # Settings page
├── shared/
│   ├── api.js                     # GitHub API helpers
│   ├── storage.js                 # chrome.storage wrappers
│   └── constants.js               # Plan allowances, badge colors, alarm name
└── icons/
    └── icon{16,32,48,128}.png
```

### Data Flow

1. User saves PAT in Options → service worker receives `FORCE_FETCH` message
2. Service worker calls `GET /user` (resolves username), `GET /user/copilot` (plan auto-detect), and `GET /users/{username}/settings/billing/premium_request/usage`
3. Results cached in `chrome.storage.local`; badge updated
4. Popup reads from cache (no live API call on popup open)
5. `chrome.alarms` fires every N minutes to repeat the cycle

---

## Security Notes

- Token is stored in `chrome.storage.local` (encrypted by Chrome's OS keychain per profile)
- Token is **never logged** to the console
- Token is only sent to `api.github.com` via HTTPS (enforced by `host_permissions`)
- Minimum required scope: `manage_billing:copilot` (classic PAT)
- Token can be rotated at any time via the Options page

---

## Future Improvements (v2+)

- GitHub OAuth device flow (no PAT paste required)
- Support for org-managed licenses (requires org admin PAT + org-level API endpoint)
- Per-model usage breakdown in popup
- Historical trend sparkline
- AI Credits mode for Pro+ users
- Spending limit / overage alerts
