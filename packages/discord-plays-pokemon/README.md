# Discord Plays Pokémon

A cooperative, [Twitch Plays Pokémon](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)–style
bot: a Discord server plays Pokémon Emerald together by sending inputs, and the
game is streamed live into a voice channel.

## How it works

Fully headless — no browser, no emulator UI, no GPU, no desktop:

- **Game** — [pokeemerald-wasm](https://github.com/ottohg/pokeemerald-wasm)
  (ottohg's fork, which adds the full C m4a audio engine) runs in Bun and renders
  frames to RGBA in software.
- **Streaming** — frames are encoded with ffmpeg and pushed to a Discord voice
  channel over the voice UDP path via `@shepherdjerred/discord-video-stream` (our
  in-repo fork of
  [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream))
  (a self-bot Go-Live), so viewers watch in the voice channel.
- **Input** — a Discord bot takes button/chord commands (plus an optional web
  UI) and feeds them into the emulator's input queue.
- **Goal agent** — optional Codex goal mode reads a versioned engine observation
  (phase, readiness, current map, collision, party, inventory, progression, and
  battle state) and plays through serialized semantic controls. Its primary
  local interface is `pokemonctl observe`, `tap`, `move`, `interact`, `wait`,
  `map show`, and bounded current-map `navigate`; raw `press` and `chord` remain
  compatibility escape hatches. CLI observations are compact by default;
  `observe --full` includes detailed readiness, collision, nearby-object,
  battler, party, inventory, and progression state for diagnostics.
- **Notifications** — the bot polls the emulator's memory (~2×/sec) and posts
  Discord embeds for in-game events: faints, gym badges, evolutions, catches,
  level-ups, whiteouts, and new Pokédex entries. Configure under
  `[bot.notifications.events]` in `config.toml` (`mode = "log"` for a
  detect-only shadow mode; `"send"` to post).

The WASM is **built from source** (ottohg pinned at `OTTOHG_SHA` +
our export patch) by `scripts/build-wasm.ts`. It is not committed; Renovate
advances the upstream pin. See `wasm-src/PATCHES.md`.

The Docker build runs the real-WASM observation ABI integration test before the
tested artifact can enter the runtime image. This is deliberately mandatory:
unit tests using constructed snapshots are not sufficient evidence that the C
layout and TypeScript decoder still agree.

## Goal agent knowledge

Goal Mode gives Codex a compact operating policy and loads game facts only
when needed. The `pokemonctl knowledge search` and `knowledge get` commands
query a committed, validated Pokémon Emerald corpus:

- Archipelago's Emerald region graph for maps, connections, warps, and terrain;
  randomizer check and logic identifiers remain explicitly labeled as
  non-vanilla metadata.
- PokeAPI's Generation III data for species, Emerald level-up moves, battle
  moves, and generation-wide item identifiers. Known FireRed/LeafGreen-only
  key items are excluded, but remaining catalog membership does not prove
  Emerald availability. Unversioned catalog prices and species capture rates
  are intentionally omitted.
- The exact pinned pokeemerald-wasm source for narrow Emerald mechanics that
  PokeAPI does not version, including Shedinja's empty-party-slot requirement.
- Bulbapedia's complete 22-part Emerald walkthrough, stored separately under
  `knowledge/cc-by-nc-sa-2.5/` and attributed under CC BY-NC-SA 2.5.

All source revisions are pinned in `knowledge/sources.json`. Regenerate the
checked-in data with `bun run generate:knowledge`. Five focused skills under
`.agents/skills/pokemon-*` teach the agent when to search each domain without
putting the encyclopedia in every prompt. Knowledge is advisory; live
`pokemonctl observe` state and action outcomes remain authoritative.

## Deployment

Runs on the homelab Kubernetes cluster via ArgoCD
(`packages/homelab/src/cdk8s/src/resources/pokemon.ts`). Image builds and
pushes are manual (the CI pipeline was removed 2026-07); configuration is a
mounted `config.toml` — see `config.example.toml`.

## Disclaimer

A fan project, unaffiliated with Pokémon or Twitch Plays Pokémon.
