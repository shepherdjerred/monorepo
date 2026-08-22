---
title: Scout design-audit reference
description: Flags, local endpoints, fixture paths, and browser modes for the Scout design audit.
sidebar:
  order: 24
---

Use this page as the source of truth for the Scout design-audit interface. The
[run guide](/how-to/run-scout-design-audit/) explains the procedures.

## Environment flags

| Flag                                         | Values            | Purpose                                                                      |
| -------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `SCOUT_DESIGN_AUDIT_MODE`                    | `pr`, `nightly`   | Select Chromium-only pull-request coverage or the Firefox and WebKit matrix. |
| `SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS`     | `true`            | Start the local marketing, docs, and app services from Playwright.           |
| `SCOUT_DESIGN_AUDIT_BASE_URL`                | URL               | Use one existing origin for all public, docs, and app routes.                |
| `SCOUT_DESIGN_AUDIT_PUBLIC_URL`              | URL               | Existing marketing-site origin when local servers are disabled.              |
| `SCOUT_DESIGN_AUDIT_DOCS_URL`                | URL               | Existing docs-site origin when local servers are disabled.                   |
| `SCOUT_DESIGN_AUDIT_APP_URL`                 | URL               | Existing app origin when local servers are disabled.                         |
| `SCOUT_DESIGN_AUDIT_GUILD_ID`                | Discord server ID | Fixture guild identifier; defaults to the committed fixture value.           |
| `SCOUT_DESIGN_AUDIT_DISCORD_ID`              | Discord user ID   | Authenticated fixture user; defaults to the committed fixture value.         |
| `SCOUT_DESIGN_AUDIT_PLAYER_ALIAS`            | Alias             | Fixture player alias; defaults to `Scout Classic`.                           |
| `SCOUT_DESIGN_AUDIT_COMPETITION_ID`          | Positive integer  | Fixture competition identifier; defaults to `1`.                             |
| `SCOUT_DESIGN_AUDIT_REPORT_ID`               | Positive integer  | Fixture report identifier; defaults to `1`.                                  |
| `SCOUT_DESIGN_AUDIT_EXPLORE_CONVERSATION_ID` | Conversation ID   | Explore fixture conversation identifier.                                     |
| `SCOUT_DESIGN_AUDIT_EXPLORE_SHARE_TOKEN`     | Share token       | Explore shared-route token.                                                  |

When local boot is enabled, the backend also receives
`SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true` internally. It selects the dedicated
design-audit database and skips external Discord and production credentials.

## Local endpoints

| Service   | URL                           | Role                  |
| --------- | ----------------------------- | --------------------- |
| Marketing | `http://127.0.0.1:4321/`      | Public Scout routes   |
| Docs      | `http://127.0.0.1:4322/docs/` | Scout documentation   |
| Backend   | `http://127.0.0.1:3000/trpc/` | Dev-login API         |
| App       | `http://localhost:5180/app/`  | Scout web application |

The browser configuration lives at
`packages/scout-for-lol/packages/design-audit/playwright.config.ts`.

## Related

- [Run the Scout design audit](/how-to/run-scout-design-audit/) — commands and troubleshooting
