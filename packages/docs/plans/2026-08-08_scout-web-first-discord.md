---
id: scout-web-first-discord
type: plan
status: in-progress
board: false
---

# Scout web-first Discord surface

## Summary

Keep Discord useful for onboarding while moving configuration to the web UI.
Retain only `/help`, `/setup`, `/status`, `/invite`, `/docs`, `/track`, and
`/list`. Ship a dedicated Starlight documentation site at `/docs/` inside the
existing lockstep Scout beta and production site artifact.

## Implementation

- Replace global Discord command registration and dispatch with the seven
  commands, removing the legacy command implementation tree and autocomplete.
- Make `/track` a current-channel happy path backed by the existing subscription
  domain service; make `/list` a compact, read-only subscription overview.
- Keep advanced player, subscription, competition, report, access, and audit
  workflows in the dashboard.
- Build 28 Diátaxis-organized Starlight pages (3 tutorials, 9 how-to guides, 11
  reference pages, 4 concept pages) and copy the docs build into the
  existing frontend bucket release alongside the marketing site and app.
- Update marketing links, welcome/outreach messages, internal docs, CI filters,
  and release entrypoint checks.

- Render the ScoutQL, permission, competition, queue, and region reference
  tables from the shipped `@scout-for-lol/data` registries via MDX, so the docs
  cannot drift from the vocabulary the product actually accepts.

## Verification

- Focused backend command tests and typecheck.
- Starlight typecheck/build and integrated Scout bucket build with all three
  entrypoints: root, app, and docs.
- `@scout-for-lol/docs-site` tests build the site and then assert the link graph
  resolves, no link double-prefixes `base`, no page hard-codes the production
  origin, and every registry entry appears in its reference table.
- Frontend build and release-pipeline validation.
- Beta/prod deployment and URL liveness remain operator-level verification.
