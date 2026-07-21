---
id: log-2026-06-03-birza-music-live-patch
type: log
status: complete
board: false
---

# Birza Music Live Patch

## Summary

Investigated Birza/Birmel production logs after Discord music requests around
2026-06-02 17:31-17:32 America/Los_Angeles failed.

The running pod was `birmel-6786cf6474-jbx4r` in namespace `birmel`, image
`ghcr.io/shepherdjerred/birmel:2.0.0-3191`. The pod had restarted three times;
the relevant previous container exited with code 1 at 2026-06-02 17:32:54.

Root cause in logs:

- `player.search()` found the YouTube result for SICKO MODE.
- Playback then failed because `@discord-player/ffmpeg` could not load ffmpeg
  from `ffmpeg`, `avconv`, `ffmpeg-static`, or installer packages.
- Immediately after, `discord-voip` crashed when accessing DAVE support because
  `@snazzah/davey` was not installed.

Applied a temporary live pod patch:

```bash
kubectl exec -n birmel birmel-6786cf6474-jbx4r -- bun add ffmpeg-static @snazzah/davey
```

Verified in the pod:

- `require("ffmpeg-static")` resolves to
  `/workspace/packages/birmel/node_modules/ffmpeg-static/ffmpeg`
- `require.resolve("@snazzah/davey")` resolves to
  `/workspace/packages/birmel/node_modules/@snazzah/davey/index.js`
- Pod remained `1/1 Running`; recent logs showed normal scheduler heartbeats and
  no new crash.

Follow-up live patching found more runtime gaps:

- `@snazzah/davey` must be present before the Birmel process starts; installing
  it into an already-running pod is too late because `discord-voip` caches the
  missing-module fallback.
- `youtube-dl-exec` was present, but its `bin/yt-dlp` binary was missing.
- The image had Bun, but no real `node` binary and no `python3`; `yt-dlp`
  requires Python, and the extractor's `jsRuntimes: "node"` requires Node for
  YouTube JS challenges.
- A temporary Deployment command patch now installs `nodejs` and `python3`,
  stages `ffmpeg-static` and `@snazzah/davey`, and starts Birmel. The active pod
  was `birmel-5bf65687c4-xzgzj` with `0` restarts.
- After manually running `youtube-dl-exec`'s postinstall in the active pod,
  bounded extraction from SICKO MODE produced `bytes=130048`.
- Discord voice playback became audible, but still had intermittent buffering /
  catch-up behavior.

The live logs also exposed a Birmel code bug in `src/music/events.ts`: the
event wrapper called Discord channel `send` with `this = undefined`, causing
`this.target.client` errors from Discord.js during queue/status messages. A
local source fix was made, but it was not rolled into the currently-running pod
because audio was mostly working and further rollout risk was not worth it.

## Session Log — 2026-06-03

### Done

- Loaded Kubernetes and Discord bot guidance.
- Queried live Birmel pod state and previous container logs.
- Identified missing runtime dependencies: `ffmpeg-static` and `@snazzah/davey`.
- Live-patched the running Birmel pod with `bun add ffmpeg-static @snazzah/davey`.
- Verified both packages resolve inside the pod and the pod remained running.
- Patched the Deployment startup command so fresh pods install `nodejs`,
  `python3`, `ffmpeg-static`, and `@snazzah/davey` before startup.
- Manually ran `youtube-dl-exec` postinstall in the active pod so `yt-dlp`
  exists.
- Verified YouTube audio extraction produces bytes from the active pod.
- Added local durable dependencies and fixed the local Discord `send` binding
  bug in `packages/birmel/src/music/events.ts`.
- User verified audible playback; playback still has intermittent buffering /
  catch-up.
- Made the image fix durable in `.dagger/src/image.ts`: Birmel images now
  install Node and Python, run `youtube-dl-exec` postinstall during image
  build, and assert the `yt-dlp` binary is executable.
- Extended `.dagger/src/misc.ts` Birmel smoke coverage to verify `gh`,
  `claude`, Node, Python, `ffmpeg-static`, `@snazzah/davey`, `yt-dlp`, Prisma
  setup, tool-set loading, and expected dummy-token Discord auth failure.
- Added `packages/birmel/src/music/channel-metadata.ts` and
  `packages/birmel/tests/music/channel-metadata.test.ts` to cover the Discord
  channel `send` binding regression.
- Confirmed Birmel music tools currently expose two tools:
  `music-playback` for play, pause, resume, skip, stop, seek, set-volume,
  set-loop, and now-playing; `music-queue` for get, add, remove, shuffle, and
  clear. There is no dedicated previous/rewind-to-previous-track action.
- Ran `bun run scripts/setup.ts` successfully after sandbox escalation.
- Ran `bun run typecheck` in `packages/birmel` successfully.
- Ran `bunx eslint . --fix` in `packages/birmel` successfully.
- Ran `bun --env-file=.env.test test tests/music/channel-metadata.test.ts`
  successfully.
- Ran full `bun run test` in `packages/birmel` successfully under escalation:
  126 pass, 5 browser-only skips, 0 failures.
- Ran `dagger functions` successfully after the local Dagger engine completed
  its first-start engine swap.
- Ran `dagger call smoke-test-birmel --pkg-dir=packages/birmel --pkg=birmel
--dep-names=llm-observability --dep-names=eslint-config
--dep-dirs=packages/llm-observability --dep-dirs=packages/eslint-config`
  successfully.

### Remaining

- Investigate remaining buffering/catch-up once the image contains the runtime
  tools natively; likely candidates are YouTube stream throughput, ffmpeg
  buffering, or Discord voice UDP jitter.
- Build, push, and roll a new Birmel image so production stops depending on the
  temporary Deployment startup patch.

### Caveats

- This remains a live Deployment/pod mutation on top of image `2.0.0-3191`, not
  a shipped image fix.
- The current active pod has `yt-dlp` because it was installed manually after
  startup. The temporary Deployment command installs Node/Python/deps, but the
  postinstall behavior needs to be made reliable before depending on pod
  restarts.
- The repository now has the durable source/image changes, but production will
  still use the temporary live patch until a new image is published and the
  Deployment/ArgoCD state is reconciled.
- Dagger emits a worktreeconfig warning while loading this Git worktree, but the
  Birmel smoke test completed successfully.
