---
id: plan-2026-08-02-minecraft-pod-fixes
type: plan
status: in-progress
board: false
---

# Fix: Minecraft pods failing (drift guard + Discord secret keys + linter blind spot)

## Context

All three homelab Minecraft servers are hibernated (`replicaCount: 0`); **mc-router**
scales a StatefulSet to 1 on player connect. When woken, the pods crash for two independent
reasons, and a third latent issue let one of them ship. Diagnosis:
[`logs/2026-08-02_minecraft-pods-failing-diagnosis.md`](../logs/2026-08-02_minecraft-pods-failing-diagnosis.md).

1. **shuxin — `Init:Error`:** the `check-config-drift` init container does a byte-exact
   `cmp -s` of `/data` vs the repo ConfigMaps and refuses to boot on any diff. Three files
   are re-normalized by Paper/plugins at runtime (not hand-edited): `commands.yml` (SnakeYAML
   flattens the block sequence), `spark/config.json` (GSON drops the trailing newline),
   `mcMMO/chat.yml` (Bukkit reorders keys).
2. **sjerred + tsmc — `CreateContainerConfigError`:** DiscordSRV `secretKeyRef`s read
   `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID`, but the 1Password item's field labels — and
   thus the synced Secret's data keys — are kebab-case `discord-bot-token` /
   `discord-channel-id`.
3. **Why CI missed #2:** `check:1password` buckets a manifest's secret consumption by the
   manifest's own `metadata.namespace`. These refs live inside an ArgoCD `Application`
   (`metadata.namespace: argocd`), but the `OnePasswordItem` is in the workload namespace
   (`minecraft-sjerred`), so the field-validation join never matches and is silently skipped.

**Decisions (confirmed with user):** relabel the 1Password fields to UPPER_SNAKE (keep the
code as-is — matches homelab's UPPER_SNAKE `secretKeyRef` house style) **and** fix the linter
blind spot.

## Fix 1 — shuxin drift: add the 3 runtime-rewritten files to the ignore list

`packages/homelab/src/cdk8s/src/misc/minecraft-drift-check.ts` `is_ignored()` — add
`./commands.yml|./spark/config.json|./mcMMO/chat.yml) return 0 ;;` (global, same mechanism as
`server.properties`/`spigot.yml`/`paper-global.yml`). Rejected: rewriting repo source to match
server bytes (Prettier re-adds the newline / re-indents; the server re-normalizes each boot).

## Fix 2 — sjerred/tsmc Discord keys: relabel 1Password + refresh snapshot

Operator action (1P access): rename field labels on both items in vault
`v64ocnykdqju4ui6j6pua56xw4` (`q37vet77dfggoqbvu4bqle3gje`, `yqp25gif2grm5gkg6l44e6vmxy`),
preserving values: `discord-bot-token` → `DISCORD_BOT_TOKEN`, `discord-channel-id` →
`DISCORD_CHANNEL_ID`. Then refresh + commit `onepassword-vault-snapshot.json`. Repo code
already references UPPER_SNAKE; update stale comments in `discordsrv-config.ts:15-19` and
`minecraft-{sjerred,tsmc}.ts:32-33`.

## Fix 3 — linter blind spot: bucket ArgoCD Application consumption by destination namespace

`scripts/check-1password-items.ts` — extend `ManifestSchema` (add `apiVersion` +
`spec.destination.namespace`) and, in `collectReferences`, bucket an ArgoCD Application's
consumption under `spec.destination.namespace` instead of `metadata.namespace`. Blast radius
in `argo-applications/` is small (only `grafana-values.ts` has a literal embedded
`secretKeyRef`, plus the two minecraft discord items via `getDiscordSrvExtraEnv`); triage any
newly-surfaced mismatch in-PR.

## Ordering (single PR)

Relabel 1P → refresh & commit snapshot → then the linter change validates against the
corrected snapshot. Fixes 1 and 3 are pure code; Fix 2's runtime effect depends on the
out-of-band 1P relabel + operator resync.

## Verification

- `cd packages/homelab/src/cdk8s && bun run scripts/check-1password-items.ts` passes (more
  field refs checked; grafana not newly failing).
- `bunx turbo run typecheck lint test --filter=@shepherdjerred/homelab-cdk8s`.
- `bun run build`; grep `dist/apps.k8s.yaml` for the new drift-check ignore arm.
- Post-deploy: secret keys show UPPER_SNAKE; force a wake (`kubectl scale ... --replicas=1`,
  allowed via `ignoreDifferences`); shuxin drift-check prints `IGNORED`, all three reach
  `Running`.

## Session Log — 2026-08-02

### Done

- **Fix 1 (drift):** added `./commands.yml|./spark/config.json|./mcMMO/chat.yml` to
  `is_ignored()` in `minecraft-drift-check.ts`; confirmed it renders into shuxin's
  `check-config-drift` command in `dist/apps.k8s.yaml` (shuxin is the only server wiring it).
- **Fix 3 (linter):** `check-1password-items.ts` now buckets an ArgoCD Application's embedded
  `secretKeyRef` consumption by `spec.destination.namespace`. Proven: pre-relabel the linter
  reported exactly the 4 discord mismatches (previously silently skipped) and nothing else;
  post-relabel it passes (137 field refs verified).
- **Fix 2 (discord keys):** relabeled `discord-bot-token`→`DISCORD_BOT_TOKEN` and
  `discord-channel-id`→`DISCORD_CHANNEL_ID` (values/CONCEALED type preserved) on both 1P items
  (`q37vet…`, `yqp25g…`) via `op item edit` create-then-delete. Refreshed
  `onepassword-vault-snapshot.json` (only the 4 discord field hashes changed). Updated stale
  comments in `discordsrv-config.ts` + `minecraft-{sjerred,tsmc}.ts`.
- Verification: typecheck ✓, eslint ✓, build ✓, `check-1password-items` ✓, cdk8s tests ✓
  (316 pass / 0 fail / 14 expected skips).
- Draft → ready PR **#1927** (branch `feature/minecraft-pod-fixes`), commits `5f1d3d4dd` +
  `9f056eeec`.

### Remaining

- **Post-deploy verification — read-only (after merge → ArgoCD sync):** confirm the synced
  secrets `minecraft-{sjerred,tsmc}-discord` expose data keys `DISCORD_BOT_TOKEN` /
  `DISCORD_CHANNEL_ID` (not the old kebab-case keys) and report the current pod/replica state
  of all three servers. Scheduled as the report-only Temporal check below.
- **Post-deploy verification — privileged force-wake (separate operator step):** at 0 replicas
  the crash paths stay dormant, so end-to-end proof needs an operator to
  `kubectl scale statefulset minecraft-{shuxin,sjerred,tsmc} -n <ns> --replicas=1` (allowed via
  `ignoreDifferences`), then confirm shuxin's drift-check prints `IGNORED (runtime-modified)`
  for the three files and all three pods reach `Running` (DiscordSRV connects on sjerred/tsmc).
  This mutates live state, so it is intentionally **not** part of the report-only automation.

<!-- temporal-agent-task
{
  "title": "Minecraft pod fixes — post-deploy secret-key + pod-state report",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-08-05T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/plans/2026-08-02_minecraft-pod-fixes.md"
  },
  "prompt": "Read-only post-deploy check for PR #1927 (branch feature/minecraft-pod-fixes). For each of the sjerred and tsmc Minecraft servers, run `kubectl get secret minecraft-<name>-discord -n minecraft-<name> -o jsonpath='{.data}'` and confirm the data keys are DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID (the UPPER_SNAKE keys the DiscordSRV secretKeyRefs read), NOT the old kebab-case discord-bot-token / discord-channel-id. Then report the current phase and replica count of the minecraft-shuxin, minecraft-sjerred, and minecraft-tsmc StatefulSets/pods. Email the result: green if both discord secrets show UPPER_SNAKE keys and no minecraft pod is in CreateContainerConfigError or Init:Error; red otherwise with the offending keys/pod states. Do NOT scale, wake, or otherwise mutate any workload — the force-wake is a separate manual operator step tracked in this plan's Remaining section."
}
-->

> The block above still needs an operator to schedule it (`cd packages/temporal &&
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc
../../packages/docs/plans/2026-08-02_minecraft-pod-fixes.md`); it is report-only and never
> performs the privileged force-wake.

### Caveats

- The 1P relabel is already applied to the live vault (out-of-band from git). If this PR is
  reverted, the code still references UPPER_SNAKE, so no drift — but the snapshot and vault
  must stay in sync.
- All deploys go through ArgoCD; do not `kubectl apply`. Manual `kubectl scale` is only OK
  because `/spec/replicas` is in each app's `ignoreDifferences` (mc-router owns it).
- This session relabeled 1P fields (normally avoided) per the explicit UPPER_SNAKE decision;
  the pods were already down, so there was no working state at risk.
  `Running`.
