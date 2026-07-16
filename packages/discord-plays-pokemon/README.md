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
- **Notifications** — the bot polls the emulator's memory (~2×/sec) and posts
  Discord embeds for in-game events: faints, gym badges, evolutions, catches,
  level-ups, whiteouts, and new Pokédex entries. Configure under
  `[bot.notifications.events]` in `config.toml` (`mode = "log"` for a
  detect-only shadow mode; `"send"` to post).

The WASM is **built from source** (ottohg pinned at `OTTOHG_SHA` +
our export patch) by `scripts/build-wasm.sh`. It is not committed; Renovate
advances the upstream pin. See `wasm-src/PATCHES.md`.

## Deployment

Runs on the homelab Kubernetes cluster via ArgoCD
(`packages/homelab/src/cdk8s/src/resources/pokemon.ts`). Image builds and
pushes are manual (the CI pipeline was removed 2026-07); configuration is a
mounted `config.toml` — see `config.example.toml`.

## Disclaimer

A fan project, unaffiliated with Pokémon or Twitch Plays Pokémon.
