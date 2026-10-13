# Discord Plays core constraints

This source-only workspace package owns behavior shared by the Pokémon and
Mario Kart backends: tracing/metrics, PCM transport, Go-Live streamer base,
web-server and Socket.IO setup, the in-browser driver feed, Discord sign-in,
PNG encoding, config loading, logging, and process boot. Package exports point directly at
`src/`.

- Dependencies use the root workspace and `workspace:*`. Do not restore the old
  per-package `file:` install scheme or per-package lockfiles.
- Core accepts game-specific loggers, metrics, hooks, sockets, and stream
  behavior through typed dependencies. Do not make it depend on Pokémon or
  Mario Kart.
- Emulators, drivers, seats, overlays, goal logic, game metrics, socket
  dispatch, driver-feed admission policy, and slash commands remain
  game-owned. Core enforces a policy a game installs; it never decides who may
  watch or play.
- `src/driver-feed/protocol.ts` and `src/auth/protocol.ts` are imported by
  browser bundles. Keep them free of Node, Bun, and non-`zod` imports.
- A change here must be verified against both consuming backends.

```bash
bun run typecheck
bun run test
bun run lint
bunx turbo run typecheck test --filter=@discord-plays-pokemon/backend --filter=@discord-plays-mario-kart/backend
```
