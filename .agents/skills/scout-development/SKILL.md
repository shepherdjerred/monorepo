---
name: scout-development
description: Develop, test, or operate Scout for League of Legends across its web apps, Discord bot, report lake, betting, custom games, analytics, and Temporal workflows. Use for work under packages/scout-for-lol.
---

# Scout development

Read `packages/scout-for-lol/AGENTS.md` and the closest package README before
editing. The public marketing site, docs, management app, Discord bot, report
renderer, report lake, desktop client, and Scout Temporal workers share one
domain but have separate runtime boundaries.

Preserve these contracts:

- `/scout ask` fronts the persisted Explore system; it is not a second query
  implementation.
- ScoutQL is compiled and validated before DuckDB execution. Guild/global scope,
  identity, deterministic ordering, and participant limits are explicit.
- Bryan Bucks owns Dare management. Explore owns conversational authoring.
  Versioned Dare semantics must preserve older stored behavior.
- Tournament custom games and ordinary Riot match ingestion remain distinct
  provenance paths.
- Discord inputs are user boundaries: answer expected mistakes clearly. Internal
  broken contracts and malformed persisted data fail loudly.
- User-visible report and message budgets are product contracts, not formatting
  suggestions.

Use the repository's local fixtures, session bootstrap, and shared report-lake
seed rather than requiring a real Discord login for routine tests. Do not alter
committed showcase or availability artifacts manually when a bot-owned refresh
workflow is their source.

## Run the UI locally

```bash
bun run --filter='./packages/scout-for-lol' dev:seed   # once: build the machine-wide lake seed
bun run --filter='./packages/scout-for-lol' dev:web    # backend :3000, SPA http://localhost:5180
bun run --filter='./packages/scout-for-lol' dev:login  # prints a signed session URL
```

- `dev:web` runs under `op run --env-file=dev-web.env.tpl`, ensures the local
  dev Postgres, applies migrations, and serves the SPA. It defaults to
  `SCOUT_DEV_AUTH_MODE=dev-login`, so no real Discord login is needed; open the
  `dev:login` URL with PinchTab.
- It copies the machine-wide lake seed in automatically. `dev:seed` only builds
  or refreshes that seed, and Explore reads the lake rather than the database.
- The default boot leaves the BETA Discord gateway alone and runs the
  application role: web surface, interactive and lake workers, report lake.
  `--discord-gateway` opts into owning that gateway, which disconnects the
  deployed beta bot for the duration — one owner per token — and is what
  guild-picker and channel-picker flows need. A secondary copy only needs
  distinct `--backend-port` and `--web-port`.
  (`packages/scout-for-lol/scripts/dev/dev-web.ts`; the warning in
  `dev-web.env.tpl` predates the opt-in default and is stale.)
- `Failed to start server. Is port 3000 in use?` means something else already
  holds the default backend port (OrbStack and other container runtimes commonly
  do). Pass `--backend-port`/`--web-port` rather than killing the holder.
- For visual inspection with no 1Password session and no Discord login, boot
  the design-audit way instead, against a separate `.design-audit-report-lake`:
  `SCOUT_DESIGN_AUDIT_LOCAL_BOOT=true bun --no-install run dev:design-audit -- --no-discord-gateway`.
  The env var is what lets the backend skip the real secrets; `dev:design-audit`
  alone still demands them.

Eight Scout workspaces have a bare `dev` script, so pick deliberately: `app` is
the SPA behind `dev:web`, `frontend` and `docs-site` are Astro, `design-system`
serves its own Vite instance, and `desktop` is Tauri.

Verify UI changes in the browser rather than from source, and keep the
screenshot or recording for the PR:

```bash
pinchtab nav http://localhost:5180/app/
pinchtab screenshot -o /tmp/scout-app.png
```

Run focused tasks for only the affected Scout workspaces, then the relevant
integration or visual flow. A successful source test does not prove the beta
deployment; verify the desired revision, logs, and user path separately.
