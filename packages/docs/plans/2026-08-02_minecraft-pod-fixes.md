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
the original investigation.

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
