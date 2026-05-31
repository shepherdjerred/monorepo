# YouTube Music Bot Kubernetes Setup

## Status

Partially Complete

## Summary

Checked the existing Birmel Discord bot and homelab CDK8s deployment for YouTube music playback readiness. Birmel already includes the music implementation, YouTube extractor dependencies, Discord voice intents, and production Kubernetes deployment with `VOICE_ENABLED=true`.

The missing Kubernetes piece was egress for Discord voice media. The existing Birmel network policy allowed DNS, Tempo, and external HTTPS only; Discord voice audio needs UDP egress.

## Session Log -- 2026-05-30

### Done

- Added external UDP egress to `packages/homelab/src/cdk8s/src/cdk8s-charts/birmel.ts` for Discord voice audio.
- Added `packages/homelab/src/cdk8s/src/birmel-network-policy.test.ts` to assert the synthesized Birmel network policy includes external UDP egress.
- Added `packages/birmel/e2e/music-playback.ts`, an opt-in live Discord music E2E that logs in with real Discord credentials, initializes Birmel's music player, plays a configured YouTube query in a configured voice channel, waits for the queue to enter playback, verifies it remains playing for a short interval, then stops playback.
- Added `bun run test:e2e:music` in `packages/birmel/package.json`.
- Documented the required E2E environment variables in `packages/birmel/.env.example`.
- Added `e2e/**/*` to `packages/birmel/tsconfig.json` so typecheck and lint cover the E2E script.

### Remaining

- Run formatting, CDK8s build/synthesis, typecheck, and tests after `mise trust` is explicitly approved for this checkout.
- If build succeeds, commit the generated Helm manifest changes from `packages/homelab/src/cdk8s/dist/` if any are produced.
- Run the live music E2E with real Discord channel IDs after the UDP egress policy is deployed:
  `bun run test:e2e:music`.

### Caveats

- Verification is blocked because `mise` refuses to run in `packages/homelab` until its config is trusted. The approval request for `mise trust` was rejected by the auto-reviewer and needs explicit user approval.
- The Birmel E2E was typechecked and linted, but not executed live because this thread does not have the required `BIRMEL_E2E_*` Discord test channel settings.

## Follow-up Verification -- 2026-05-30

### Done

- Checked the live `birmel` namespace. Pod `birmel-7889897db8-qsbmz` is `1/1 Running` with two restarts, last restart about 38 hours before the check.
- Checked startup logs. Birmel came online as `Birza#0582`, registered the YouTubei extractor, and logged `Music player initialized`.
- Checked the currently applied `birmel-egress-netpol`. It allows DNS, Tempo TCP/4318, and external TCP/443 only.
- Verified Birmel after adding the live music E2E harness:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run test` outside the sandbox, because OTLP integration tests need to bind ephemeral local ports
- Added `packages/birmel/e2e/youtube-stream-resource.ts`, a smaller opt-in E2E that does not log into Discord. It searches YouTube with Birmel's registered YouTubei extractor, obtains the stream that would feed playback, wraps it with `createAudioResource`, and verifies the resulting Discord audio resource emits a non-empty Opus packet.
- Added `bun run test:e2e:youtube-stream` in `packages/birmel/package.json`.
- Updated `packages/birmel/src/music/extractors.ts` to use a yt-dlp-backed stream mode, ignore user yt-dlp config while streaming to stdout, and throw when extractor registration fails or returns no extractor.

### Remaining

- Ship and sync the UDP egress NetworkPolicy change before expecting Discord voice audio to work from Kubernetes.
- Perform an actual Discord voice playback test after ArgoCD applies the policy.
- Re-run `bun run test:e2e:youtube-stream` with `BIRMEL_E2E_YOUTUBE_QUERY` set after the yt-dlp-backed extractor change to verify YouTube stream extraction and Discord audio resource formatting without needing a Discord guild.
- Execute `bun run test:e2e:music` with `DISCORD_TOKEN`, `BIRMEL_E2E_GUILD_ID`, `BIRMEL_E2E_TEXT_CHANNEL_ID`, `BIRMEL_E2E_VOICE_CHANNEL_ID`, and `BIRMEL_E2E_YOUTUBE_QUERY` set.

### Caveats

- There is no live log evidence of a successful music playback attempt.
- Direct YouTubei stream extraction failed in this environment: `IOS` returned `could not stream`, `ANDROID` returned YouTube `FAILED_PRECONDITION`, and `TV_EMBEDDED` returned `This video is unavailable`. The custom yt-dlp-backed mode returned a readable stream in a probe.
- `bun run test:e2e:youtube-stream` was added as a smaller pre-Discord check; it still requires live YouTube network access, local FFmpeg/Avconv for arbitrary stream transcoding, and the yt-dlp binary used by `youtube-dl-exec`.
- `bun run test:e2e:music` was not executed in this thread because no Discord test voice/text channel IDs were provided.

## Session Log -- 2026-05-31

### Done

- Added `packages/birmel/e2e/youtube-stream-resource.ts`, a small opt-in YouTube-to-Discord-resource E2E that does not join Discord. It searches YouTube, obtains the stream through Birmel's registered extractor, creates a Discord audio resource, and asserts a non-empty Opus packet can be read.
- Added `bun run test:e2e:youtube-stream` to `packages/birmel/package.json` and documented the shared E2E env knobs in `packages/birmel/.env.example`.
- Updated `packages/birmel/src/music/extractors.ts` to use custom yt-dlp-backed streaming with `ignoreConfig: true`, without enabling the extractor's startup updater, and fail fast if extractor registration fails or returns no extractor.
- Updated `packages/birmel/tests/setup.ts` so the mocked extractor registration still matches the stricter production registration contract.
- Verified:
  - `bun run prettier --write packages/birmel/e2e/youtube-stream-resource.ts packages/birmel/src/music/extractors.ts packages/birmel/tests/setup.ts packages/birmel/package.json packages/docs/logs/2026-05-30_youtube-music-bot-k8s.md`
  - `cd packages/birmel && bun run typecheck`
  - `cd packages/birmel && bun run lint`
  - `cd packages/birmel && bun run test` outside the sandbox, because OTLP integration tests need ephemeral local port binding
  - `cd packages/birmel && BIRMEL_E2E_YOUTUBE_QUERY='lofi hip hop radio' bun run test:e2e:youtube-stream` with network access

### Remaining

- Deploy and sync the Birmel Kubernetes UDP egress NetworkPolicy before expecting Discord voice playback from the cluster.
- Run the heavier live Discord voice E2E with real guild, text channel, and voice channel IDs: `bun run test:e2e:music`.

### Caveats

- The smaller E2E proves YouTube stream extraction can produce the Discord audio resource format locally; it does not prove the bot can join a Discord voice channel from Kubernetes.
- YouTubeJS still logs signature decipher warnings during extractor activation, but the yt-dlp-backed stream path successfully produced a Discord Opus packet.
- The targeted homelab CDK8s test could not be run locally because `packages/homelab/mise.toml` is not trusted in this checkout.

## PR Follow-up -- 2026-05-31

### Done

- Created branch `codex/birmel-youtube-music-e2e`, committed the Birmel YouTube stream E2E and homelab NetworkPolicy changes, pushed it, and opened PR #998.
- Addressed Greptile P1/P2 review findings:
  - Renamed the local yt-dlp child-process handle in `packages/birmel/src/music/extractors.ts` so it no longer shadows the runtime `process` global.
  - Adjusted yt-dlp stream cleanup so normal consumer shutdown is quiet while real yt-dlp failures can still be logged.
  - Restricted Birmel Discord voice egress in `packages/homelab/src/cdk8s/src/cdk8s-charts/birmel.ts` to UDP ports 50000-65535 instead of all UDP ports.
  - Updated `packages/homelab/src/cdk8s/src/birmel-network-policy.test.ts` to assert the bounded UDP range.
- Verified the follow-up fixes with:
  - `cd packages/birmel && bun run lint`
  - `cd packages/birmel && bun run typecheck`
  - `cd packages/birmel && bun run test`
  - `cd packages/birmel && BIRMEL_E2E_YOUTUBE_QUERY='lofi hip hop radio' bun run test:e2e:youtube-stream`
  - `cd packages/homelab/src/cdk8s && bun test src/birmel-network-policy.test.ts`
  - `cd packages/homelab/src/cdk8s && bun run typecheck`
  - `cd packages/homelab && bunx eslint --fix src/cdk8s/src/birmel-network-policy.test.ts src/cdk8s/src/cdk8s-charts/birmel.ts`

### Remaining

- Push the follow-up commit and wait for Buildkite plus review bots to rerun on the new head commit.
- Run the heavier live Discord voice E2E with real guild, text channel, and voice channel IDs: `bun run test:e2e:music`.

### Caveats

- Buildkite PR build #3106 had a Trivy soft failure, which is intentionally not considered blocking for this PR loop.
- GitHub CLI authentication is invalid in this checkout, so PR creation and review inspection used the GitHub connector instead.
