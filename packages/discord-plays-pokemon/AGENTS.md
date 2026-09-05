# Discord Plays Pokémon constraints

This app runs Pokémon Emerald in a headless emulator, streams it to Discord,
and can execute bounded semantic goals. `README.md` owns the runtime and
benchmark reference.

- Generated species, map, battle, and walkthrough data is application runtime
  knowledge. Regenerate it through the owning scripts; do not hand-edit output.
- Package-local `.agents/skills` are shipped goal-agent assets. Keep their IDs,
  paths, and concise frontmatter compatible with the runtime loader and its
  tests. They are not repository workflow skills.
- The goal agent acts through typed `pokemonctl` semantic state/actions. Do not
  scrape pixels or add hidden emulator shortcuts to make a benchmark pass.
- Goal success comes from observed game state. Provider, authentication,
  harness, and game failures are distinct benchmark outcomes.
- Benchmark comparisons use the same corpus, model configuration, limits, and
  artifact schema. Never grade invalid infrastructure evidence as game failure.
- Shared Go-Live lifecycle, transport, tracing, metrics, and boot behavior
  belongs in `@shepherdjerred/discord-plays-core`.
- Subscription authentication is limited to the existing goal workload. Never
  print, persist, or expose its token to model tools.

```bash
bun run typecheck
bun run test
bun run lint
bun run --cwd packages/backend smoke
```

Run a real-model goal benchmark only when requested and credentials are already
available. Preserve generated benchmark artifacts as private diagnostic data.
