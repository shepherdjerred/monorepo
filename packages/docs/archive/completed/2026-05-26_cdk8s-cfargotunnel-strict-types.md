---
id: reference-completed-2026-05-26-cdk8s-cfargotunnel-strict-types
type: reference
status: complete
board: false
---

# Tighten CDK8s types for `networking.cfargotunnel.com` (and fix the bugs that surface)

## Context

Two ArgoCD apps (`cloudflare-tunnel`, `s3-static-sites`) were stuck with `SyncError` because their rendered manifests used wrong-cased CRD field names:

- `ClusterTunnel.spec.cloudflare.cloudflareTunnelCredentialSecret` → not in schema; field is for `existingTunnel:` mode only and is dead code in our `newTunnel:` setup.
- 11 × `TunnelBinding.tunnelRef.disableDnsUpdates` → must be `disableDNSUpdates`. The bug meant the operator had been racing OpenTofu to manage DNS for `resume.sjer.red`, `cook.sjer.red`, `webring.sjer.red`, `stocks.sjer.red`, apex `sjer.red`, `clauderon.com`, `discord-plays-pokemon.com`, `scout-for-lol.com`, `beta.scout-for-lol.com`, `ts-mc.net`, `better-skill-capped.com` — silently, because the apiserver's structural-schema check rejects the field but doesn't fail the sync hard enough to be loud.

Root cause that let these ship: CDK8s types for `networking.cfargotunnel.com` were loose. Commit `36cf04bb9` ("fix(homelab): keep generated cdk8s bindings", 2026-05-24) replaced `cdk8s import` output (which had needed `@ts-nocheck` to compile) with minimal hand-written stubs that extend `CompatProps` = `{ readonly metadata?: ApiObjectMetadata; readonly [key: string]: unknown; }`. Any string-keyed property typechecks — `disableDnsUpdates`, `cloudflareTunnelCredentialSecret`, anything.

**Fixing the casing bugs without fixing the types is whack-a-mole.** The plan: tighten the types first so the bugs surface as compile errors, then fix them, then ship.

## Approach: strict types live in `src/`, not `generated/`

Initial draft of the plan called for editing the existing shim at `generated/imports/networking.cfargotunnel.com.ts`. The user vetoed: anything in `generated/` is owned by `scripts/update-imports.ts` and will be wiped on the next regeneration. Strict overrides have to live outside the generated tree.

Final architecture:

1. **New file at `packages/homelab/src/cdk8s/src/cdk8s-types/cfargotunnel.ts`** — hand-maintained strict types for the `networking.cfargotunnel.com` v1alpha1 CRDs. Builds directly on cdk8s `ApiObject` (not on the `CompatApiObject` shim in `_compat.ts`), so it's independent of the generator entirely.
2. **Consumers re-pointed** to import from `@shepherdjerred/homelab/cdk8s/src/cdk8s-types/cfargotunnel.ts` instead of `@shepherdjerred/homelab/cdk8s/generated/imports/networking.cfargotunnel.com.ts`. Three files: `src/misc/cloudflare-tunnel.ts`, `src/misc/s3-static-site.ts`, `src/resources/cloudflare-tunnel.ts`.
3. **Generated shim left alone.** `generated/imports/networking.cfargotunnel.com.ts` is now an unused dead path within the package, but leaving it intact preserves the generator contract. When `update-imports.ts` is next run, it will continue to overwrite that file with whatever `cdk8s import` produces, and our strict types in `src/` are unaffected.

The strict interfaces mirror the live CRD `openAPIV3Schema` exactly. Source-of-truth queries (rerun these when bumping cloudflare-operator):

```bash
kubectl get crd clustertunnels.networking.cfargotunnel.com \
  -o jsonpath='{.spec.versions[?(@.name=="v1alpha1")].schema.openAPIV3Schema}'
kubectl get crd tunnelbindings.networking.cfargotunnel.com \
  -o jsonpath='{.spec.versions[?(@.name=="v1alpha1")].schema.openAPIV3Schema}'
```

Scope is limited to this one CRD. The other shims (`argoproj.io.ts`, `k8s.ts`, `monitoring.coreos.com.ts`, etc.) keep their loose typing — they haven't caused incidents and broadening scope risks regressions.

## Bug fixes that the strict types surfaced

### 1. `src/resources/cloudflare-tunnel.ts`

Dropped the `cloudflareTunnelCredentialSecret: "credential"` line and its misleading comment. In `newTunnel:` mode, the `CLOUDFLARE_TUNNEL_CREDENTIAL_*` fields don't apply — they're for `existingTunnel:` mode only. The cluster has been Healthy for months without our intent ever reaching the live spec, so removing the line is a no-op for behavior.

### 2. `src/misc/s3-static-site.ts`

Replaced the inline `new TunnelBinding(…)` block (the only TunnelBinding call site that wasn't going through the shared helper) with a call to `createCloudflareTunnelBinding()`. This eliminates the casing bug and brings the resulting `TunnelBinding` in line with the rest of the cluster (helper-emitted labels + finalizer match what the operator-controller adds at runtime, removing perpetual managed-fields churn).

### 3. `src/misc/cloudflare-tunnel.ts` (helper signature relax)

The helper's first parameter was typed `chart: Chart`. The `S3StaticSites` class extends `Construct` (not `Chart`), so calling the helper from inside it failed typecheck. `TunnelBinding` only needs a `Construct` parent, so relaxing the helper to `scope: Construct` was the right fix. Existing callers (which all passed `Chart`) still work since `Chart extends Construct`.

## Verification (all green)

- `bun run typecheck` — clean.
- `bun run lint` — clean (after `--fix` converted interfaces → type aliases per repo convention).
- `bun test` — 107 pass, 5 skip, 0 fail.
- `bun run build` — synth completed.
- `rg -n "cloudflareTunnelCredentialSecret|disableDnsUpdates" dist/` → no matches.
- `rg -c "disableDNSUpdates" dist/` → 31 occurrences (30 × `: true` on resources, plus 1 in the `apps.ts` ArgoCD `ignoreDifferences.jqPathExpressions` reference). Live cluster had 28 TunnelBindings before; the extra synthesised ones are for tunnels not yet deployed (e.g., status-page, minecraft-shuxin/sjerred bluemaps).
- Rendered `dist/cloudflare-tunnel.k8s.yaml` confirms ClusterTunnel spec is `{ accountId, domain, secret, newTunnel.name }` — no dead credential field.

## Pre-merge / pre-sync checklist (still to do before this ships)

- **Tofu DNS sanity check.** Before the `disableDNSUpdates: true` flip takes effect on the 11 s3-static-sites hostnames, run `op run --env-file=.env -- tofu -chdir=cloudflare plan` from `packages/homelab/src/tofu` and apply any pending diff. Tofu has records for all 11 hostnames (spot-checked); confirm none have drifted to operator-managed state.
- **PR description.** Call out the behavior change: operator stops managing DNS for the 11 hostnames; Tofu becomes the sole owner.
- **ArgoCD sync after chart publish.**

  ```bash
  argocd app sync cloudflare-tunnel --grpc-web
  argocd app sync s3-static-sites   --grpc-web
  argocd app wait cloudflare-tunnel s3-static-sites --grpc-web --sync --timeout 300
  ```

  Expected: `Sync Status: Synced`, `Health Status: Healthy`, `CONDITIONS: <none>` for both.

## Follow-ups (separate PRs)

- **Extend strict types to other CRDs as they bite.** Same pattern: new file in `src/cdk8s-types/<kebab-group>.ts`, repoint consumers. Strongest candidates next: `argoproj.io.ts` (Application/AppProject), `monitoring.coreos.com.ts` (Probe, ServiceMonitor).
- **`update-imports.ts` deserves a closer look.** Today it runs `cdk8s import` and pastes `@ts-nocheck` headers — but the generated/imports files have been hand-stubbed and don't reflect that workflow. Either rebuild the script to produce the current stubs, or formally retire it. Out of scope here but worth a todo.
- **2026-04-05 homelab health audit gap.** That audit touched this area but missed the `s3-static-site.ts` inline `new TunnelBinding(…)`. Worth a note in the next audit pass.

## Session Log — 2026-05-26

### Done

- Created `packages/homelab/src/cdk8s/src/cdk8s-types/cfargotunnel.ts` with strict TypeScript interfaces mirroring the live CRD schema, plus `ClusterTunnel` and `TunnelBinding` classes built directly on cdk8s `ApiObject`.
- Repointed three consumers (`src/misc/cloudflare-tunnel.ts`, `src/misc/s3-static-site.ts`, `src/resources/cloudflare-tunnel.ts`) to import from the new path.
- Verified strict types surface the two known casing bugs at `bun run typecheck`.
- Fixed `src/resources/cloudflare-tunnel.ts:22-23` — dropped dead `cloudflareTunnelCredentialSecret: "credential"`.
- Fixed `src/misc/s3-static-site.ts:402-421` — replaced inline `new TunnelBinding(…)` with `createCloudflareTunnelBinding()`. Helper now correctly emits `disableDNSUpdates: true` for all 11 static-site TunnelBindings.
- Relaxed `createCloudflareTunnelBinding`'s first param from `chart: Chart` to `scope: Construct` so it can be called from `S3StaticSites` (which extends `Construct`, not `Chart`).
- Lint, typecheck, test, build all green. Rendered YAML has zero bad-casing occurrences and 30 × `disableDNSUpdates: true`.
- Branch: `fix/cdk8s-cfargotunnel-strict-types` (off `origin/main`). Not committed yet — user can decide commit/PR timing.

### Remaining

- Open the PR with the four touched files plus the new strict-types file plus this plan doc.
- Run `op run --env-file=.env -- tofu -chdir=cloudflare plan` from `packages/homelab/src/tofu` before/at-merge to verify no DNS drift on the 11 hostnames.
- After chart publish + ArgoCD sync, confirm both `cloudflare-tunnel` and `s3-static-sites` apps land `Synced`/`Healthy`/no `SyncError`.

### Caveats

- `generated/imports/networking.cfargotunnel.com.ts` is now effectively unused by the codebase but still exists. Don't delete — `scripts/update-imports.ts` will recreate it on next run. If anyone re-points an import back to the generated path by accident, they'll lose strict typing silently (no compile error). Worth an ESLint `no-restricted-imports` rule as a follow-up.
- The strict types only cover fields we currently use. If we add a `tolerations` block or other ClusterTunnel field later, we'll need to extend the interface — but typecheck will tell us, and we'll go re-pull the CRD schema to get the shape right.
- Operator behavior change for the 11 s3-static-sites hostnames is real (operator stops touching DNS). Today both operator and Tofu point to `<tunnelId>.cfargotunnel.com`, so there's no externally-visible diff — but get Tofu's plan to zero pending changes before sync to be safe.
