---
id: pokemon-docs-site
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
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
  [large-file-cleanup.md](large-file-cleanup.md) is not tracked on main.)
- Other monorepo docs sites (e.g. Astro/Starlight or Docusaurus) can serve as a
  template; pick one consistent with how `*.sjer.red` sites are hosted (see the
  static-site hosting topology — most are SeaweedFS S3 buckets, CI-synced).

## Remaining

- [ ] A docs site exists for discord-plays-pokemon with a simplified getting-started
      flow, feature pages for goal mode / event notifications / Go-Live streaming,
      and a clear "Emerald only" statement.
- [ ] It's built + hosted (or at least buildable in CI) like the other doc sites.
