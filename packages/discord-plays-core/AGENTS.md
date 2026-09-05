# Discord Plays core constraints

This source-only workspace package owns behavior shared by the Pokémon and
Mario Kart backends: tracing/metrics, PCM transport, Go-Live streamer base,
web-server wiring, and process boot. Package exports point directly at `src/`.

- Dependencies use the root workspace and `workspace:*`. Do not restore the old
  per-package `file:` install scheme or per-package lockfiles.
- Keep `src/index.ts` free of re-exports. Consumers use explicit subpath imports.
- Core accepts game-specific loggers, metrics, hooks, sockets, and stream
  behavior through typed dependencies. Do not make it depend on Pokémon or
  Mario Kart.
- Emulators, drivers, seats, overlays, goal logic, game metrics, socket
  dispatch, and slash commands remain game-owned.
- A change here must be verified against both consuming backends.

```bash
bun run typecheck
bun run test
bun run lint
bunx turbo run typecheck test --filter=@discord-plays-pokemon/backend --filter=@discord-plays-mario-kart/backend
```
