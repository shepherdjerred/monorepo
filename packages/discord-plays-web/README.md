# @shepherdjerred/discord-plays-web

Shared browser code for the Discord Plays web UIs,
[discord-plays-pokemon](../discord-plays-pokemon/) and
[discord-plays-mario-kart](../discord-plays-mario-kart/). The backend half of
the same plumbing lives in [discord-plays-core](../discord-plays-core/).

Each game keeps its own theme, layout, and game panels. This package holds the
parts that behave the same in both:

- `src/feed/driver-feed-client.ts` — `connectDriverFeed()`: opens the driver
  feed WebSocket, decodes H.264 with WebCodecs, and hands each frame to a
  painter and each audio chunk to a player. Reconnects with backoff and
  resyncs at keyframes. The wire contract is
  `@shepherdjerred/discord-plays-core/driver-feed/protocol.ts`.
- `src/feed/use-driver-feed.ts` — `useDriverFeed()`: the feed painted onto a
  canvas the game renders, its status, and an `onPaint` hook for reading
  pixels back (Mario Kart's HUD clock).
- `src/feed/feed-audio.ts`, `use-feed-sound.ts` — gapless Web Audio playback
  of the feed's PCM and `useFeedSound()`, a remembered mute choice that
  reports when the browser is still blocking sound.
- `src/input/` — `useControls()` tracks held controls and reports genuine
  press/release edges; `useKeyboardControls()` binds the keyboard, ignoring
  form fields and releasing everything on blur.
- `src/controller/press-button.tsx` — `PressButton`, an unstyled on-screen
  button: pointer capture, multi-touch, a haptic tick, no long-press menu.
  Games style it as their own hardware.
- `src/socket/game-socket-client.ts` — the same-origin, WebSocket-only
  Socket.IO client; `socket-request.ts` sends one request and awaits its
  schema-validated reply with a timeout.
- `src/bootstrap/mount-game-app.tsx` — `mountGameApp()`: Sentry (DSN per
  game, release and mode from the build), react-query, and the React root.
- `src/vite/game-vite-config.ts` — `defineGameViteConfig()`: shared plugins
  and the `vite dev` proxies for `/socket.io`, `/video`, and `/api`.

The PostHog snippet stays in each game's `index.html`, because
`scripts/checks/check-analytics-sites.ts` verifies every site's snippet and
masking settings statically.

## Consumption

Source-only, like discord-plays-core: `package.json#exports` maps `./*` to
`src/`, and frontends import subpaths such as
`@shepherdjerred/discord-plays-web/feed/use-driver-feed.ts`. Changes here must be
verified against both frontends.

```bash
bun run typecheck
bun run test
bun run lint
bunx turbo run typecheck test build --filter=@discord-plays-pokemon/frontend --filter=@discord-plays-mario-kart/frontend
```
