# Plan: Birmel pinchtab outage — P0 unblock, P1 in-cluster pinchtab

## Status

Complete — pinchtab deployed in-cluster (resources/pinchtab, cdk8s + argo app, helm chart); birmel rewired to the shared 1Password token.

## Context

Birmel (Discord bot, `birmel` namespace) went **down** in a `CreateContainerConfigError`
loop: `couldn't find key PINCHTAB_TOKEN in Secret birmel/birmel-birmel-1p`.

Root cause: commit `bf827d07d` (2026-06-02, "add durable agent capabilities") added a
`PINCHTAB_TOKEN` env var to birmel's deployment, sourced via `EnvValue.fromSecretValue`
from the 1Password-synced "Birmel" item — but that item never got a `PINCHTAB_TOKEN`
field. The kubelet can't build the container env, so the pod never starts.

Separately, birmel points at `pinchtab.pinchtab.svc.cluster.local:9867`, but the
`pinchtab` namespace was **empty** — pinchtab only ran on the owner's Mac. Goal: stop
depending on the laptop and run pinchtab in-cluster.

Deploy path: edit cdk8s → commit → Buildkite/Dagger CI publishes the helm chart to
chartmuseum → ArgoCD auto-syncs. Never `kubectl apply` directly.

## P0 — Unblock birmel (separate hotfix PR)

birmel's own config treats the token as optional (`packages/birmel/src/config/schema.ts:140`,
`pinchtabToken: z.string().optional()`) and instantiates the pinchtab client lazily — so the
only thing crashing the pod is the K8s secret-key reference.

`packages/homelab/src/cdk8s/src/resources/birmel/index.ts`: remove the `PINCHTAB_TOKEN`
`EnvValue.fromSecretValue` block (the missing-key ref) and add `BROWSER_ENABLED=false`.

Verify: `kubectl get pods -n birmel` → `1/1 Running`. Browser automation is off until P1.

## P1 — Deploy pinchtab in-cluster (follow-up PR)

Image `pinchtab/pinchtab` is amd64-compatible (single `torvalds` node) with first-class
Docker support.

1. **versions.ts** — pin `pinchtab/pinchtab` to
   `0.13.2@sha256:9cf0d94352f3e322e9897e61030b5bb90693334f8e5aa1b25a572d892fb3b13c`
   (multi-arch index digest) with a Renovate `datasource=docker` annotation.
2. **resources/pinchtab/index.ts** — Deployment (recreate), ZFS `/data` (10 GiB),
   Memory-backed `/dev/shm` (2 GiB via `EmptyDirMedium.MEMORY`), ConfigMap `config.json`
   (bind 0.0.0.0, headless, stateDir/profiles under `/data`) mounted at `/config` with
   `PINCHTAB_CONFIG`, token from the shared 1Password item via `PINCHTAB_TOKEN`,
   `/health` startup+liveness+readiness probes, Service `pinchtab:9867`, TailscaleIngress.
3. **cdk8s-charts/pinchtab.ts** — namespace `pinchtab`; NetworkPolicies (ingress from
   `birmel` + `tailscale` on 9867; egress DNS + internet 80/443). Registered in
   `setup-charts.ts`.
4. **helm/pinchtab/** Chart.yaml + values.yaml; `scripts/ci/src/catalog.ts` →
   `HELM_CHARTS`; `argo-applications/pinchtab.ts` wired in `apps.ts`.
5. **Shared token** — new "PinchTab" 1Password item (vault `v64ocnykdqju4ui6j6pua56xw4`,
   id `t2dgtdx47yd2gegad6zeelzylu`, field `PINCHTAB_TOKEN`), synced into both `pinchtab`
   and `birmel` namespaces.
6. **birmel re-wire** — `birmel/index.ts`: second `OnePasswordItem` (`birmel-pinchtab-1p`)
   → shared item; `PINCHTAB_TOKEN` from it; drop `BROWSER_ENABLED=false`. `birmel.ts`:
   add egress rule birmel → `pinchtab` ns on 9867.

## Verification (done locally)

- homelab `bun run typecheck` → pass (P0 state and P1 end-state).
- `scripts/ci` pipeline generation → pass (catalog validated, 29 packages).
- eslint on all changed files → clean.
- cdk8s synth → `dist/pinchtab.k8s.yaml` generated; confirmed Service `pinchtab/pinchtab:9867`,
  `/dev/shm` `medium: Memory sizeLimit 2048Mi`, token `secretKeyRef pinchtab-token`,
  birmel egress to pinchtab ns:9867, no `BROWSER_ENABLED` in birmel P1 state.

Post-deploy: `kubectl get pods,svc -n pinchtab`; `kubectl exec -n pinchtab <pod> -- wget
-qO- localhost:9867/health` → `defaultInstance.status == "running"`; trigger a birmel
browser action and confirm it reaches in-cluster pinchtab.

## Caveats

- **Fresh profile.** The `birmel` pinchtab profile (cookies/logins) lived on the Mac;
  in-cluster starts clean. Confirm the `birmel` profile auto-creates on first use vs needs
  pre-creating via the API.
- **Datacenter IP.** Browsing from the homelab IP may trip more CAPTCHAs/bot detection.
- **shm vs memory limit.** The 2 GiB Memory emptyDir counts against the 4 GiB container
  memory limit.
- **readOnlyRootFilesystem.** Started as `false` (matches other homelab services); upstream
  recommends `true` — can harden later with extra writable mounts.
- **PR ordering.** P0 and P1 both edit `birmel/index.ts`. P1 is independent off main; after
  P0 merges, P1 needs a trivial rebase (P1's env block wins).

## Session Log — 2026-06-06

### Done

- Diagnosed the outage: missing `PINCHTAB_TOKEN` key in the 1Password-synced secret;
  pinchtab namespace empty (ran only on the Mac).
- P0 (branch `claude/birmel-disable-browser-p0`): disabled the browser tool / removed the
  missing-key secret ref in `resources/birmel/index.ts`.
- P1 (branch `claude/sleepy-thompson-4dd56c`): pinned image; created
  `resources/pinchtab/index.ts`, `cdk8s-charts/pinchtab.ts`, `argo-applications/pinchtab.ts`,
  `helm/pinchtab/`; registered in `setup-charts.ts`, `apps.ts`, `catalog.ts`; re-wired birmel
  to the shared token + added egress netpol.
- Created the shared "PinchTab" 1Password item (id `t2dgtdx47yd2gegad6zeelzylu`).
- Verified: typecheck, eslint, CI pipeline gen, cdk8s synth all green.

### Remaining

- Open + merge the P0 PR (immediate birmel recovery), then the P1 PR.
- After deploy: confirm pinchtab pod healthy, Chrome ready, and a birmel browser action
  round-trips to in-cluster pinchtab. Resolve the `birmel` profile auto-create question.

### Caveats

- See Caveats above (fresh profile, datacenter IP, shm/memory, read-only FS, PR rebase).
