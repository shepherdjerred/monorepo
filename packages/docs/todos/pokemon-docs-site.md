---
id: pokemon-docs-site
type: todo
status: in-progress
board: true
verification: agent
disposition: active
source_marker: false
---

# Create a discord-plays-pokemon docs site with simplified instructions

## What

`packages/discord-plays-pokemon` has no docs site — only `README.md` and
`ROADMAP.md`. Build a proper docs site that:

- Gives **simplified setup/run instructions** (the current README is terse).
- Focuses on the **recent features**: goal mode, in-game event → Discord
  notifications, and the headless Discord Go-Live game streamer.
- States explicitly that **only Pokémon Emerald is supported**.

## Why it's open

The bot has grown several features (goal mode, event notifications, headless
streamer) that aren't documented anywhere user-facing, and there's no single
place that explains setup or the Emerald-only constraint.

## Notes

- No docs scaffold exists on `main` today. (The
  `docs/docs/.../demo.mp4` path referenced in
  `large-file-cleanup.md` is not tracked on main.)
- Other monorepo docs sites (e.g. Astro/Starlight or Docusaurus) can serve as a
  template; pick one consistent with how `*.sjer.red` sites are hosted (see the
  static-site hosting topology — most are SeaweedFS S3 buckets, CI-synced).

## Remaining

- [ ] Choose the existing monorepo static-site pattern and add a docs package
      with a tested production build.
- [ ] Write a minimal getting-started flow plus focused pages for goal mode,
      event notifications, and Go-Live streaming; state the Emerald-only
      support boundary prominently.
- [ ] Wire CI build/deploy ownership and verify all documented commands and
      links against the current package before publishing.

## Comment Log

### 2026-07-27 — in-progress board audit

- Retained as active. No docs-site scaffold exists; user-facing guidance remains
  limited to the package README and roadmap.
