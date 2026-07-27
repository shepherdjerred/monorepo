---
name: screenshot
description: Boot a fresh isolated dev server for a package, drive a real Chrome instance via PinchTab to a route, and capture a screenshot — the happy-path way to visually verify a frontend change in this monorepo.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# Screenshot Skill

Visually verify a frontend change without a manual browser session: boots
a package's dev server (a fresh, isolated one on its fixed port — never
reused), drives a real PinchTab-controlled Chrome tab to a route,
screenshots it, and cleans up after itself.

Prerequisite: PinchTab must already be running (`pinchtab health`). See the
`pinchtab-helper` skill for setup — this tool is a thin wrapper around the
`pinchtab` CLI, not a new browser-automation stack.

## Commands

```bash
toolkit screenshot <package> [route] [options]
toolkit screenshot --list          # print the registry
```

| Option                    | Meaning                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--out <path>`            | Output PNG path (default: a tmp path, printed)                                                                                                                |
| `--wait-for-selector <s>` | CSS selector to poll for before capturing (default: fixed settle delay)                                                                                       |
| `--timeout <ms>`          | Default 60000                                                                                                                                                 |
| `--discord-id <id>`       | Authenticate as this Discord ID, for packages that require it (e.g. `scout-app`); defaults to a fake test user. Pass the real owner ID to see owner-gated UI. |
| `--env KEY=VALUE`         | Repeatable; passes env vars to the spawned dev server (e.g. `VITE_CONTRACT_HASH=…`)                                                                           |
| `--viewport <WxH>`        | e.g. `1280x800`                                                                                                                                               |
| `--theme <light\|dark>`   | CSS `prefers-color-scheme` emulation                                                                                                                          |
| `--full-page`             | Capture the full scrollable page, not just the viewport                                                                                                       |
| `--json`                  | Machine-readable `{path, url, durationMs}`                                                                                                                    |

## Registry

Zero-auth packages (`packages/toolkit/src/lib/screenshot/catalog.ts`):
`sjer-red`, `stocks-sjer-red`, `cooklang-rich-preview`, `better-skill-capped`,
`docs-board`, `scout-marketing`, `mario-kart-frontend`, `pokemon-frontend`.

Auth-gated: `scout-app` (`packages/scout-for-lol`) — boots the full
`dev:web` stack (backend + Vite) and signs in via the backend's
`/api/dev/login` dev-only route (registered only when `environment=dev`
AND `ENABLE_DEV_LOGIN=true`, which `dev:web` sets — so it never ships
enabled to beta/prod) instead of a real Discord OAuth click-through.

**Explicitly out of scope** (different tooling needed, not attempted here):
`scout-for-lol/packages/desktop` (Tauri/Rust — no browser-drivable dev
server) and `tasks-for-obsidian` (React Native/Metro — needs a
simulator/device).

## Examples

```bash
# Plain zero-auth package
toolkit screenshot stocks-sjer-red /

# Scout's authenticated web app, as a specific (real) Discord user
toolkit screenshot scout-app /app/ --discord-id 160509172704739328

# Dark mode, custom viewport, wait for content before capturing
toolkit screenshot sjer-red /blog --theme dark --viewport 1440x900 \
  --wait-for-selector "article"
```

## Limitations (v1)

- **No network-response mocking.** PinchTab has no request-interception
  primitive comparable to Playwright's `page.route()`, so this tool can show
  what a route currently renders authenticated as a given user — it cannot
  fake a backend response to force an otherwise-unreachable state. If a
  screenshot needs a specific backend-driven state that can't occur locally
  (e.g. a genuine version-hash mismatch between frontend and backend), the
  practical path is a PinchTab profile with a real login against the actual
  deployed environment showing that state, not this tool.
- Setup cost: PinchTab itself must be running and configured
  (`pinchtab-helper` skill) — this tool does not install or launch the
  PinchTab daemon.
- **One server per port.** A fresh spawn binds the package's fixed
  `expectedPort`; if that port is already in use (another dev server, or a
  shared-port sibling like the other `:4321` sites) the tool fails fast with an
  actionable message rather than auto-bumping to an unknown port and risking a
  screenshot of the wrong app. Stop the other server (or screenshot that one)
  and retry.

## One-time setup

```bash
pinchtab health   # confirms the daemon is reachable; see pinchtab-helper skill if not
```

No new dependency is installed by this tool — it shells out to the
`pinchtab` binary already on the machine, the same way `toolkit pr` shells
out to `gh`.
