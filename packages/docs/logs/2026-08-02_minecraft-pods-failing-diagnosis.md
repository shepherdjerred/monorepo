---
id: 2026-08-02_minecraft-pods-failing-diagnosis
type: log
status: complete
board: false
---

# Minecraft pods failing — diagnosis (2026-08-02)

User asked why the Minecraft pods were failing. All three homelab Minecraft
servers had a pod up and crashing. Two independent root causes, both only
exposed because **mc-router** had woken the servers from hibernation.

## Context: hibernation

The charts pin `replicaCount: 0` (e.g. `minecraft-sjerred.ts:62`) and let
`mc-router` scale each StatefulSet to 1 on player connect (ignoreDifferences on
`/spec/replicas`, `minecraft-sjerred.ts:191`). At diagnosis time all three
StatefulSets showed `replicas=1`, i.e. mc-router had woken all three ~26 min
prior. These failures are dormant while idle at 0 replicas and only surface when
someone tries to join.

## Root cause 1 — sjerred + tsmc: `CreateContainerConfigError`

```
Error: couldn't find key DISCORD_CHANNEL_ID in Secret minecraft-sjerred/minecraft-sjerred-discord
```

DiscordSRV env wiring (`misc/discordsrv-config.ts:84-111`) references
UPPERCASE_SNAKE secret keys:

- `DISCORDSRV_TOKEN` → key `DISCORD_BOT_TOKEN`
- `CFG_DISCORD_CHANNEL_ID` → key `DISCORD_CHANNEL_ID`

The synced secrets `minecraft-{sjerred,tsmc}-discord` only have lowercase-kebab
keys: `discord-bot-token`, `discord-channel-id` (verified via
`kubectl get secret ... -o jsonpath='{.data}'`). Mismatch → kubelet can't find
the key → `CreateContainerConfigError` (112+ retries over 26m).

This is a **known, documented bug**: `discordsrv-config.ts:15-19` describes it
and says it's "dormant" because the server runs at 0 replicas. The 1Password
item field labels are lowercase-kebab; the code expects canonical uppercase.
Documented fix: relabel the 1P fields to `DISCORD_BOT_TOKEN` /
`DISCORD_CHANNEL_ID`, refresh the vault snapshot
(`scripts/snapshot-1password-vault.ts`), re-sync — **not** lowercase the code.

Open question: `check:1password` linter is supposed to catch a `secretKeyRef`
pointing at a non-existent field, but this slipped through. Worth checking
whether the vault snapshot is stale or these particular refs aren't synthesized
for the linter.

## Root cause 2 — shuxin: `Init:Error` on `check-config-drift`

shuxin has **no** discord secret (`minecraft-shuxin-discord` NotFound), so it
never reaches root cause 1. It dies earlier in the `check-config-drift` init
container (`misc/minecraft-drift-check.ts`), which compares live `/data` against
the repo-baked ConfigMaps and refuses to boot (exit 1) on any drift. Detected:

- `/data/commands.yml` — list indentation (`- version` vs `  - version`)
- `/data/plugins/spark/config.json` — missing trailing newline
- `/data/plugins/mcMMO/chat.yml` — reordering / whitespace

All cosmetic, but the guard is strict and working as designed. Fix: reconcile the
repo configs with the volume (or vice-versa), commit, redeploy.

## Session Log — 2026-08-02

### Done

- Diagnosed both Minecraft failure modes via `kubectl describe` / `logs` and
  cross-referenced homelab source (`misc/discordsrv-config.ts`,
  `misc/minecraft-drift-check.ts`, `resources/argo-applications/minecraft-*.ts`).
- Confirmed hibernation model (mc-router scales 0→1) as the trigger.
- Confirmed sjerred/tsmc discord secret keys are lowercase-kebab vs uppercase
  refs; confirmed shuxin has no discord secret and fails on drift-check instead.

### Remaining

- Fix shipped in PR **#1927** — see `plans/2026-08-02_minecraft-pod-fixes.md`. Chosen
  approach: shuxin → drift ignore-list; sjerred/tsmc → relabel 1P to UPPER_SNAKE (done) +
  snapshot refresh; plus the `check:1password` linter blind spot (Application-embedded
  `secretKeyRef`s now bucketed by destination namespace). Post-deploy verification pending
  in that plan's Session Log.

### Caveats

- All changes to these apps go through ArgoCD/GitOps; do not `kubectl apply` or
  mutate the StatefulSets directly (per `packages/homelab/CLAUDE.md`).
- Fixing the code without fixing 1P (or vice-versa) leaves the mismatch; both
  sides must agree on the key names.
