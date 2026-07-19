---
id: log-2026-06-06-streambot-mariokart-k8s-fix
type: log
status: complete
board: false
---

# Streambot + Mario Kart k8s deploy fixes

## Context

Three Discord game/stream bots on the homelab cluster (`torvalds`): streambot (`media` ns),
mario-kart (`mario-kart` ns), pokemon (`pokemon` ns). Live state was: pokemon healthy,
streambot `ImagePullBackOff`, mario-kart `ContainerCreating` (FailedMount). Pokemon was fine.

## Root causes

| Service    | Symptom          | Root cause                                                                                                                                                                                   |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| streambot  | ImagePullBackOff | `ghcr.io/shepherdjerred/streambot` package was **private**; no imagePullSecret infra exists in homelab → kubelet pulled anonymously → 401.                                                   |
| mario-kart | FailedMount      | OnePasswordItem pointed at placeholder id `mariokartconfigreplaceme`, which doesn't exist → secret `mario-kart-mario-kart-config` never created. Image was also private (same as streambot). |
| pokemon    | (healthy)        | `discord-plays-pokemon` package is public; nothing wrong.                                                                                                                                    |

The image digests themselves were already correct on `main` — CI's version commit-back
(`2.0.0-3527`) had filled in real digests for all three. The blockers were purely
package visibility + the 1Password placeholder.

## Fixes

### Streambot (live only — no code change)

- Owner flipped the `streambot` ghcr package to **public** (matching the `discord-plays-pokemon`
  convention; homelab has no imagePullSecret pattern).
- Forced a fresh pull; pod went `Running 1/1`, logged into Discord as `glidiot_` (streamer) +
  `Glidiot Helper` (command bot), library scanned (2216 items).
- No PR needed: the digest was already committed by CI; visibility is a GitHub setting, not code.

### Mario Kart (code + 1Password)

- `discord-plays-mario-kart` ghcr package flipped to **public** too.
- Created 1Password item **"MK64 Config"** in the `Homelab (Kubernetes)` vault
  (`v64ocnykdqju4ui6j6pua56xw4`, item id `fcugoc3kohpmfwzfvko4hgysyq`) with a field labeled
  exactly `config.toml` (matches how the OnePasswordItem operator derives the secret key —
  verified against the live `pokemon-pokemon-config` secret, keys `[config.toml, password, toml]`).
  - **Gotcha:** `op item create "config.toml[text]=…"` parses the `.` as a section separator
    (creates section `config`, field `toml`). Escape it: `"config\.toml[text]=…"`.
- Config reuses the dedicated MK64 accounts (1Password items "Discord MK64" userbot +
  "MK64 Helper" bot), the Diamond Dudes server (`1337623164146155593`), the existing Voice
  channel (`1337623164955398253`), and the `blitter-goys` text channel (`1337631455085334650`).
  Validated against `ConfigSchema` (smol-toml strictObject) — all keys present, no extras, bounds OK.
- Updated `packages/homelab/src/cdk8s/src/resources/mario-kart.ts` itemPath to the real id.

## Session Log — 2026-06-06

### Done

- Diagnosed all three live (kubectl): pokemon healthy, streambot ImagePullBackOff (private pkg),
  mario-kart FailedMount (placeholder 1P item).
- Streambot: confirmed public-package fix, verified pod healthy + Discord login.
- Mario-kart: created "MK64 Config" 1Password item (`fcugoc3kohpmfwzfvko4hgysyq`), validated config
  against schema, updated `resources/mario-kart.ts` itemPath. `bun run typecheck` green.

### Remaining

- **Copy the MK64 ROM into the pod** after it schedules:
  `kubectl cp mariokart64.z64 mario-kart/<pod>:/workspace/packages/discord-plays-mario-kart/roms/mariokart64.z64`
  (never baked into image/secret — copyright). Until then the emulator can't boot.
- Merge the PR → CI rebuilds the `mario-kart` helm chart → ArgoCD syncs the real item id →
  secret is created → pod mounts config. (Do not `kubectl apply`/patch directly.)

### Caveats

- mario-kart and pokemon share the **same Voice channel** (`1337623164955398253`). They use
  separate userbot accounts (glidiot\_ vs Discord MK64) so they can stream simultaneously, but
  both Go-Live into the same channel — fine for testing; consider a dedicated voice channel later.
- `stream.minimum_in_channel=1`, `dynamic_streaming=true` for mario-kart (stream starts when
  someone joins the voice channel).
- Stale historical reference to `mariokartconfigreplaceme` remains in
  `packages/docs/logs/2026-06-06_discord-plays-mario-kart.md` (left as-is; it's a dated journal).
