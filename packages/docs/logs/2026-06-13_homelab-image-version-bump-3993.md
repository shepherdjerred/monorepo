# Manual image version bump → 2.0.0-3993 (all CI-managed images)

## Status

In Progress — live cluster bumped (with GitOps caveats); PR blocked on a 1Password snapshot refresh (needs `op` signin).

## Why

The CI **version-commit-back** step (`scripts/ci/src/steps/version.ts` → `.dagger/src/release.ts` `versionCommitBackHelper`) had stopped updating `packages/homelab/src/cdk8s/src/versions.ts`. State at session start:

- ghcr: every `shepherdjerred/*` app image had a fresh `2.0.0-3993` tag (build 3993, source `593bec9ec` = main HEAD).
- git `versions.ts`: stuck at `2.0.0-3960` for all of them (mcp-gateway was a `0.0.0-placeholder`).
- live cluster: mostly `2.0.0-3921` (even more stale), reconciled by ArgoCD against chartmuseum charts.

User asked to manually replicate the commit-back for **all** images: bump live first, then PR.

## What the bump targets

Faithful to what the real commit-back does (`update-versions.ts` only rewrites `/beta` + unsuffixed keys, never `/prod`):

- **Bumped → 2.0.0-3993** (13): streambot, redlib, scout-for-lol/beta, starlight-karma-bot/beta, birmel, discord-plays-pokemon, discord-plays-mario-kart, caddy-s3proxy, tasknotes-server, obsidian-headless, mcp-gateway, temporal-worker, trmnl-dashboard.
- **Left intentionally**: `scout-for-lol/prod` (2.0.0-2985), `starlight-karma-bot/prod` (2.0.0-2970) — deliberate prod promotions the commit-back never touches; `golink` (`main` tag, digest unchanged).

Digests captured via `crane digest ghcr.io/shepherdjerred/<img>:2.0.0-3993`.

## GitOps reality (important)

The homelab live state is owned by **ArgoCD → chartmuseum charts**; image pins come from `versions.ts` at chart-render time. `kubectl set image` patches get **reverted** whenever ArgoCD syncs an app to its chart. Autosync is on with `selfHeal=false`, so:

- A patch holds until the next chart publish/sync for that app, then snaps back to the chart's pin (currently `3960`, matching git).
- During the session ArgoCD progressively reverted patched apps `3993 → 3960` (observed on media/streambot, scout-beta first).
- **The only durable bump is the `versions.ts` PR** → CI re-renders charts pinning `3993` → ArgoCD syncs. The live kubectl patches were a best-effort bridge.

## birmel — root cause was NOT the image

birmel crashlooped (pre-existing, ~133m+ before the session) on the `youtube-dl-exec` postinstall hitting `api.github.com` (anonymous 60/hr rate limit, cluster egress IP). Root cause = a **stale manual `command`/`args` override** on the live deployment (a "birmel-live-patch" doing `apt-get install nodejs python3 && bun add ffmpeg-static @snazzah/davey && … && node scripts/postinstall.js && bun run start`). That override is **not in cdk8s or Dagger** — pure manual cruft.

The 3993 image already bakes everything needed (`.dagger/src/image.ts`): `withBirmelMusicRuntime` (nodejs/python3/curl), `bun install --frozen-lockfile` (ffmpeg-static + @snazzah/davey, both in `packages/birmel/package.json`), and `installYtDlp` (yt-dlp via the rate-limit-proof release CDN, SHA-verified) — with a Dagger smoke test (`misc.ts:278-286`) proving voice-readiness. **Fix = delete the override**; birmel then boots clean on the native entrypoint. Done — birmel `1/1`, 0 restarts, clean prisma boot. No image/code change required.

## mcp-gateway

Was `0.0.0-placeholder` (image never existed → ImagePullBackOff / ArgoCD Degraded). Build 3993 produced the first real image, but the ghcr package was **private** (homelab has no imagePullSecret; first-party packages must be public — `reference_ghcr_first_party_public`). User made it public mid-session → now `2.0.0-3993`, `1/1`.

## Blocker — 1Password snapshot gate

Pre-commit `onepassword-items` fails on 6 pre-existing stale-snapshot fields (BUILDKITE_API_TOKEN, DISCORD_TOKEN, ED_API_TOKEN, GRADESCOPE_EMAIL/PASSWORD, OPENAI_API_KEY — from recently-added integrations). Fix: `cd packages/homelab/src/cdk8s && bun run scripts/snapshot-1password-vault.ts` (needs `op` signin), commit the refreshed `onepassword-vault-snapshot.json`. Snapshot refresh can't mask a genuinely-missing field, so it's safe.

## Session Log — 2026-06-13

### Done

- Diagnosed the broken commit-back; confirmed ghcr 3993 exists for all 13 images; captured digests.
- `versions.ts`: bumped all 13 beta/unsuffixed images `3960`/placeholder → `2.0.0-3993` via `.buildkite/scripts/update-versions.ts` (prod + golink untouched). Homelab typecheck passes.
- Live: `kubectl set image` rolled all 13 to 3993; verified health (pokemon ✓ no prisma issue, scout-beta ✓ processing games, etc.). ArgoCD has since reverted some back to 3960 (chart pin).
- birmel: removed the stale live-patch `command`/`args` override → healthy on native 3993 entrypoint. Confirmed the image already bakes yt-dlp/ffmpeg-static/@snazzah/davey/node/python.
- mario-kart confirmed serving the skeuomorphic controller UI on 3993 (bundle markers present; old 3921 had zero).

### Remaining

- **Land the PR**: refresh the 1Password snapshot (needs `op` signin), stage `versions.ts` + snapshot, commit on `feature/mk64-pin-3993`, push, open PR.
- After merge: confirm CI re-renders + publishes charts pinning 3993 and ArgoCD syncs all apps durably to 3993 (the kubectl patches will otherwise keep reverting to the chart pin).
- **Fix the version-commit-back itself** — root cause of the whole staleness. Separate investigation: why has it stopped updating `versions.ts` since build 3960?

### Caveats

- kubectl image patches are ephemeral here — ArgoCD reverts to the chart pin (3960) until the PR's chart publishes. Do not rely on the live patches holding.
- mario-kart 3993 still has the `--skip-generate` baked entrypoint (#1171 open); it works live via a separate `command` override. A clean ArgoCD sync of mario-kart from git would crashloop until #1171's image lands. (Unrelated to this bump.)
- birmel override removal is durable (field not in chart); its image pin will follow the chart (3960 → 3993 after the PR).
