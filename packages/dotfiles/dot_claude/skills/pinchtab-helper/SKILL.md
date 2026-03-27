---
name: pinchtab-helper
description: |
  PinchTab browser automation - profiles, instances, multi-instance routing, tabs, actions, and anti-detection
  When user mentions PinchTab, browser automation, pinchtab commands, headed/headless browser, or web scraping with Chrome
---

# PinchTab Browser Automation

## Core Concepts

- **Profile**: stored browser state on disk (cookies, local storage, history, extensions). Persistent across restarts.
- **Instance**: a running Chrome process backed by a profile. One profile can have at most one active instance.
- **Tab ID**: opaque string returned by API. Never construct them.
- **Shorthand routes** (`pinchtab nav`, `pinchtab eval`, `pinchtab snap`): proxy to the **default/first instance**. Do NOT use when targeting a non-default profile.

## Critical: Multi-Instance Routing

**Shorthand CLI commands route to the default instance.** When working with a non-default profile:

1. Get the instance ID: `pinchtab instances`
2. Use instance-scoped CLI: `pinchtab instance navigate <instanceId> <url>`
3. Or use REST API with instance-scoped routes (see API section below)

The `always-on` strategy auto-respawns the default instance — stopping it is futile. To prevent this, change strategy to `explicit` in config:

```bash
pinchtab config set multiInstance.strategy explicit
```

## Authentication & CAPTCHAs

- **HttpOnly cookies** (session tokens) CANNOT be set via `document.cookie` or `pinchtab eval`. They can only be set by actual browser login flows.
- **CAPTCHAs** (Cloudflare Turnstile, reCAPTCHA) cannot be solved by headless browsers. At the first sign of a CAPTCHA, immediately start **headed** mode and ask the user to solve it.
- After user logs in via headed mode, cookies persist in the profile. Do NOT restart the instance — that may lose the session.
- For subsequent runs, start headless from the same profile to reuse persisted cookies.

## Rate Limiting

PinchTab has no built-in rate limiting for target sites. When making multiple API calls:

- Add `await new Promise(r => setTimeout(r, 2000))` between fetch calls in `pinchtab eval` scripts
- For bulk operations, use PinchTab's scheduler with `maxInflight` to control concurrency
- Sites like LeetCode trigger bot detection with rapid automated requests

## CLI Quick Reference

### Server & Config

```bash
pinchtab health                    # Check server health
pinchtab config                    # Show config
pinchtab config set <path> <val>   # Set config value
pinchtab instances                 # List running instances
pinchtab profiles                  # List profiles
```

### Instance Management

```bash
# Start instance (prefer REST API for full control)
curl -s -X POST http://localhost:9867/instances/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"profileId":"prof_xxx","mode":"headed"}'

# Stop instance
curl -s -X POST http://localhost:9867/instances/<id>/stop \
  -H "Authorization: Bearer $TOKEN"

# Get auth token
jq -r .server.token "$HOME/Library/Application Support/pinchtab/config.json"
```

### Shorthand Commands (default instance only)

```bash
pinchtab nav <url>                 # Navigate
pinchtab snap                      # Accessibility snapshot
pinchtab snap --interactive        # Interactive elements only
pinchtab snap --compact            # Token-efficient format
pinchtab click <ref>               # Click element (e.g. "e5")
pinchtab click "css:#btn"          # Click by CSS selector
pinchtab click "find:login button" # Click by semantic search
pinchtab fill <ref> <text>         # Fill input field
pinchtab type <ref> <text>         # Type into element
pinchtab press <key>               # Press key (Enter, Tab, Escape)
pinchtab text                      # Extract page text
pinchtab screenshot                # Take screenshot
pinchtab tab                       # List tabs
pinchtab eval '<js>'               # Execute JavaScript
```

### Instance-Scoped Commands (target specific instance)

```bash
pinchtab instance navigate <instanceId> <url>
pinchtab instance logs <instanceId>
pinchtab instance stop <instanceId>
```

## REST API Reference

Base URL: `http://localhost:9867`
Auth: `Authorization: Bearer <token>`

### Profiles

| Method | Endpoint                     | Description                 |
| ------ | ---------------------------- | --------------------------- |
| GET    | `/profiles`                  | List profiles               |
| POST   | `/profiles`                  | Create profile              |
| DELETE | `/profiles/{id}`             | Delete profile              |
| POST   | `/profiles/{nameOrId}/start` | Start instance from profile |
| POST   | `/profiles/{nameOrId}/stop`  | Stop profile's instance     |

### Instances

| Method | Endpoint                    | Description                    |
| ------ | --------------------------- | ------------------------------ |
| GET    | `/instances`                | List running instances         |
| POST   | `/instances/start`          | Start new instance             |
| POST   | `/instances/{id}/stop`      | Stop instance                  |
| POST   | `/instances/{id}/tabs/open` | Open tab in specific instance  |
| GET    | `/instances/{id}/tabs`      | List tabs in specific instance |

### Tabs (cross-instance, by tab ID)

| Method | Endpoint                   | Description                        |
| ------ | -------------------------- | ---------------------------------- |
| POST   | `/tabs/{tabId}/navigate`   | Navigate tab                       |
| GET    | `/tabs/{tabId}/snapshot`   | Get accessibility snapshot         |
| GET    | `/tabs/{tabId}/text`       | Extract page text                  |
| GET    | `/tabs/{tabId}/cookies`    | Get cookies (read-only)            |
| POST   | `/tabs/{tabId}/action`     | Execute action (click, type, etc.) |
| GET    | `/tabs/{tabId}/screenshot` | Capture screenshot                 |
| POST   | `/tabs/{tabId}/close`      | Close tab                          |

### Scheduler (if enabled)

| Method | Endpoint             | Description |
| ------ | -------------------- | ----------- |
| POST   | `/tasks`             | Submit task |
| GET    | `/tasks`             | List tasks  |
| POST   | `/tasks/{id}/cancel` | Cancel task |

## Config Reference

Config location: `~/Library/Application Support/pinchtab/config.json`

Key settings:

```json
{
  "server": { "token": "..." },
  "instanceDefaults": {
    "mode": "headed", // or "headless"
    "stealthLevel": "full" // "light", "medium", "full"
  },
  "multiInstance": {
    "strategy": "explicit", // "simple", "explicit", "simple-autorestart"
    "allocationPolicy": "fcfs" // "fcfs", "round_robin", "random"
  },
  "scheduler": {
    "enabled": true,
    "maxInflight": 5,
    "maxPerAgentInflight": 2
  }
}
```

## Stealth Levels

- **light**: Minimal anti-detection
- **medium**: Enhanced measures
- **full**: Maximum anti-detection (recommended for sites with bot detection)

## Common Patterns

### Login to a site with CAPTCHA

```bash
# 1. Start headed instance on a persistent profile
TOKEN=$(jq -r .server.token "$HOME/Library/Application Support/pinchtab/config.json")
curl -s -X POST http://localhost:9867/instances/start \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"profileId":"prof_xxx","mode":"headed"}'

# 2. Navigate to login page
pinchtab instance navigate <instanceId> https://example.com/login

# 3. Fill credentials
pinchtab fill "css:#username" "myuser"
pinchtab fill "css:#password" "mypass"

# 4. Ask user to solve CAPTCHA in the headed window
# 5. After login, cookies persist in profile for future headless use
```

### Bulk operations with rate limiting

```javascript
// In pinchtab eval - add delays between API calls
(async () => {
  for (const item of items) {
    await fetch(url, { method: "POST", body: JSON.stringify(item) });
    await new Promise((r) => setTimeout(r, 2000)); // 2s delay
  }
  window.__result = "done";
})();
```

### Read async eval results

```bash
# pinchtab eval returns {} for async results
# Store result in window.__result, then read it after a delay
pinchtab eval '(async () => { window.__r = await fetch(...).then(r => r.text()); })()'
sleep 2
pinchtab eval 'window.__r'
```
