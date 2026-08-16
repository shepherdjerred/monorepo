# Scout design audit

The design audit exercises shipped Scout public, documentation, and app routes
with the four Scout themes and the desktop/laptop/tablet/mobile viewport
matrix. It is read-only: app forms are rendered and keyboard-tested, but no
mutation is submitted.

Run the deterministic checks locally with:

```bash
bun run check:tokens
bun test src
```

Browser checks require the branch-built Scout surfaces. Set
`SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true` to have Playwright start the
public site, docs site, and app/backend, or set
`SCOUT_DESIGN_AUDIT_PUBLIC_URL`, `SCOUT_DESIGN_AUDIT_DOCS_URL`, and
`SCOUT_DESIGN_AUDIT_APP_URL` when the surfaces use existing origins. A single
origin can be supplied with `SCOUT_DESIGN_AUDIT_BASE_URL`.

Local origins use Scout's loopback-only `/api/dev/login` route. Beta runs use a
fresh Discord OAuth flow with `SCOUT_DESIGN_AUDIT_DISCORD_EMAIL`,
`SCOUT_DESIGN_AUDIT_DISCORD_PASSWORD`, and optionally
`SCOUT_DESIGN_AUDIT_DISCORD_TOTP`. These values are runtime CI secrets and
must never be committed.

```bash
SCOUT_DESIGN_AUDIT_MODE=pr \
SCOUT_DESIGN_AUDIT_START_LOCAL_SERVERS=true \
SCOUT_DESIGN_AUDIT_DISCORD_ID=000000000000000001 \
bun run test:e2e
```

Use `SCOUT_DESIGN_AUDIT_MODE=nightly` to add Firefox and WebKit to the
Chromium matrix. Nightly CI must provide either one base URL or all three
surface URLs, plus the dedicated read-only Discord credentials. Visual
snapshots are updated only
through an explicit local Playwright update command after review; CI never
updates them. The reviewed command is `bun x --no-install playwright test
--update-snapshots` from this package directory.
