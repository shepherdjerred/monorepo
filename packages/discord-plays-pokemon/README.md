# Discord Plays Pokémon

A cooperative, [Twitch Plays Pokémon](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)–style
bot: a Discord server plays Pokémon Emerald together by sending inputs, and the
game is streamed live into a voice channel.

## How it works

Fully headless — no browser, no emulator UI, no GPU, no desktop:

- **Game** — [pokeemerald-wasm](https://github.com/tripplyons/pokeemerald-wasm)
  runs in Bun and renders frames to RGBA in software.
- **Streaming** — frames are encoded with ffmpeg and pushed to a Discord voice
  channel over the voice UDP path via
  [`@dank074/discord-video-stream`](https://github.com/dank074/Discord-video-stream)
  (a self-bot Go-Live), so viewers watch in the voice channel.
- **Input** — a Discord bot takes button/chord commands (plus an optional web
  UI) and feeds them into the emulator's input queue.

The WASM blob is vendored at `packages/backend/assets/pokeemerald.wasm` and
refreshed periodically by a Temporal workflow that opens a PR.

## Deployment

Runs on the homelab Kubernetes cluster via ArgoCD
(`packages/homelab/src/cdk8s/src/resources/pokemon.ts`). The image is built in
CI (Dagger); configuration is a mounted `config.toml` — see
`config.example.toml`.

## Disclaimer

A fan project, unaffiliated with Pokémon or Twitch Plays Pokémon.
