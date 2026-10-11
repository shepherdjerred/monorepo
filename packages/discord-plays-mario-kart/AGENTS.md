# Discord Plays Mario Kart constraints

This app runs headless Mario Kart 64. Drivers watch a low-latency in-browser
feed on the controller page; spectators watch the Go-Live stream in Discord.
`README.md` owns the architecture, controls, harness, profiling, and deployment
reference.

- The copyrighted ROM is never committed, encrypted into Git, logged, or copied
  into an image. Local harnesses resolve only the explicit path/environment and
  documented Syncthing locations. Production uses the existing private PVC.
- Go-Live and driver-feed video are independent. Drivers watch the in-browser
  driver feed, which production enables (the code default is off); Go-Live is
  the spectator view. Do not couple a driver-feed failure to spectator playback.
- Shared stream lifecycle, tracing, metrics, audio transport, web server, and
  boot behavior belong in `@shepherdjerred/discord-plays-core`.
- Controller input is authoritative only for its assigned seat and current
  session. Validate socket events and never trust a client-supplied guild,
  channel, or user identity.
- Emulation timing is monotonic and frame-paced. Profile real ROM-backed paths
  before changing frame skip, buffer, encoder, or copy behavior.
- Prisma-backed session/leaderboard state must disconnect during shutdown.

Routine CI uses ROM-free unit and integration tests. Real emulator scenarios,
media probes, and performance harnesses are manual acceptance layers.

```bash
bun run typecheck
bun run test
bun run lint
bun run --cwd packages/backend smoke
```

For ROM-gated work, run the named harness from the README and capture the
relevant controller/stream evidence without publishing ROM-derived assets.
