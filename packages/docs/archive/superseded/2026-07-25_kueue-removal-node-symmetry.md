---
id: 2026-07-25-kueue-removal-node-symmetry
type: plan
status: in-progress
board: false
---

# Kueue removal + symmetric node treatment (liskov/torvalds)

## Context

liskov (CI-only worker, Ryzen 9950X) joins the cluster via draft PR #1629 (`feature/liskov-join`, worktree `.claude/worktrees/liskov-join`). Two agreed follow-on refactors:

1. **Remove Kueue entirely.** It was admission-control scar tissue for CI/prod cohabitation; with CI on a dedicated tainted node (kubelet reservations, eviction, pids cap) plus Buildkite's own `max-in-flight`, the node is the bulkhead. Kueue is also an active incident source (ephemeral-storage admission freeze, phantom OutOfSync, leader-election churn). **User decision: removal merges AFTER the liskov cutover** (Kueue's 12 CPU quota is today's only CI throttle on torvalds).
2. **Symmetric node treatment.** No root-dir/subdir asymmetry, no special-casing: `src/talos/<node>/` per node + one shared node registry in cdk8s instead of scattered hostname constants.

Delivery: **ONE PR — everything folds into the existing draft #1629** (`feature/liskov-join`, same worktree) as two additional commits on the branch: commit "symmetry" (workstream A below) and commit "remove kueue" (workstream B). Separate commits keep review/revert granular; one PR keeps process minimal (user preference).

Combining is also _safer_ than sequencing: the Buildkite nodeSelector (already in #1629) and the Kueue teardown land in the same ArgoCD sync, so there is no window where CI runs unthrottled on torvalds (Kueue gone, CI still there) nor throttled on liskov (CI moved, 12 CPU quota still gating). The single merge gate — **liskov Ready + `zfspv-pool-nvme` created** — now covers the entire change. PR #1629's body/title get updated to reflect the expanded scope and gate.

All file paths below relative to `packages/homelab/` unless noted.

---

## Workstream A — symmetric Talos layout (commit 1 on #1629)

**Move (git mv, history-preserving):** `src/talos/image.yaml` → `src/talos/torvalds/image.yaml`; `src/talos/patches/*` → `src/talos/torvalds/patches/*` (incl. `tailscale.example.yaml`). Shared files stay at `src/talos/`: `update-image-id.ts`, `pods/`, `README.md`, `.gitignore`. `src/talos/liskov/` already matches this shape.

**Hard breakers to update (from inventory):**

- `src/talos/update-image-id.ts:14-15` — NODES entry for torvalds: `image.yaml` → `torvalds/image.yaml`, `patches/image.yaml` → `torvalds/patches/image.yaml` (liskov entry already correct; `readmeFile ../../README.md` unaffected).
- Root `renovate.json:31` — torvalds managerFilePattern → `packages/homelab/src/talos/torvalds/patches/image.yaml`.
- `src/talos/.gitignore:5` — `patches/tailscale.yaml` no longer matches after the move. Replace with `*/patches/tailscale.yaml` (covers both nodes). Verify with `git check-ignore` for both node paths before committing.

**Doc/path refs to update:** `src/talos/README.md` (directory structure + the `--patch @src/talos/patches/…` example → per-node paths); `packages/homelab/README.md:52` (`--config-patch @patches/image.yaml` example); stale sibling-path comments inside the moved torvalds patch files (`talos/patches/…` → `talos/torvalds/patches/…`); `packages/dotfiles/dot_agents/skills/talos-helper/SKILL.md:155` (chezmoi dual-edit: also update the live copy under `~/.agents/skills/` if present).

**No change needed (verified):** `packages/homelab/package.json:22` `check:talos` (script path unmoved), `turbo.json` `src/talos/**` input glob, `eslint.config.ts` ignore.

**Node registry (cdk8s):** rename `src/cdk8s/src/misc/ci-node.ts` → `misc/nodes.ts` as the single per-node registry — torvalds (hostname; comment: control-plane + prod + Intel hardware) and liskov (hostname, taint key/value, toleration helpers — content unchanged from ci-node.ts). Update the three hostname literals to import from it: `resources/cpu-power-cap.ts:42` (`TARGET_NODE_HOSTNAME`), `resources/home/zwave-js-ui.ts:28` (`ZWAVE_NODE_HOSTNAME`), and all existing `ci-node.ts` importers (buildkite.ts, 4 monitoring DaemonSets, alloy, openebs, prometheus, resource-monitoring rules). Leave `velero.ts:96,120` `torvalds/…` R2 prefixes as literals (renaming breaks backup continuity) with a pointer comment.

---

## Workstream B — remove Kueue (commit 2 on #1629)

**⚠️ Ordering constraint (from inventory):** Kueue gates CI via its `batch/job` webhook: the `buildkite` namespace label `kueue.x-k8s.io/managed-namespace: "true"` (`buildkite.ts:32`) + `manageJobsWithoutQueueName: true` make it suspend every CI Job until quota admission. Deleting the queues while label + controller survive ⇒ every Job suspended forever, zero pods, hard CI freeze (same class as the 2026-07-24 incident). Everything synths from the same app-of-apps, so **one PR removes label + controller + queues together**; ArgoCD applies them in one sync.

**Delete outright:**

- `src/cdk8s/src/resources/kueue-config.ts` + `kueue-config.test.ts`
- `src/cdk8s/src/resources/argo-applications/kueue.ts`
- `cdk8s-charts/apps.ts:61-62,132-133` (imports + calls)
- `buildkite.ts:32` namespace label
- `resources/monitoring/kubernetes-event-exporter.ts:53-56` (kueue.x-k8s.io Workload RBAC rule)
- `src/versions.ts:197-199` (kueue pin + renovate comment)
- `generated/helm/kueue.types.ts`, `generated/imports/kueue.x-k8s.io.ts`, `generated/helm/index.ts:22` export
- `scripts/parse-helm-charts.ts:20` — remove `"kueue"` from `OCI_CHART_KEYS`
- `resources/argo-applications/kyverno.ts:32` — drop `"kueue-system"` from the webhook exclusion list

**Keep (commonly mistaken for Kueue artifacts — inventory flagged both):** the `KubeLimitRange` in buildkite.ts (independent sidecar defaults; rewrite its "so Kueue can account" comment), and `grafana/dashboard-query-health.test.ts:37`'s `not.toContain("kueue_")` guard (still-true invariant). `BUILDKITE_MAX_IN_FLIGHT = 20` stays as the sole concurrency cap — rewrite its comment (`buildkite.ts:18-22,122-129`) to say exactly that. Keep the pipeline.yml `ephemeral-storage` requests AND limits (legitimate scheduler accounting + /var freeze protection); edit their Kueue-referencing comments only.

**Comment-only edits:** `.buildkite/pipeline.yml:43-44,100-102,126`; `buildkitd.ts:59-60,121`; `kyverno.ts:20,40`; `packages/temporal/src/shared/schemas.ts:65`; `src/talos/liskov/README.md:85` ("raise the Kueue quota" → concurrency revisit via max-in-flight); `src/helm-types/src/chart-fetcher.ts:68` example; skills (chezmoi source + live): `buildkite-helper/SKILL.md` + its `references/kubernetes-agent-stack.md` Kueue section, `helm-types-gen/SKILL.md:106`.

**Docs grooming (same PR):**

- `packages/docs/todos/torvalds-controller-restart-churn.md` — Kueue-churn todo: resolve + archive to `archive/completed/` (verify its content actually is Kueue-scoped at impl time).
- `packages/docs/plans/2026-07-22_ci-capacity-remediation-impl.md` — re-groom around liskov: Track 1 (torvalds quota/right-sizing) superseded by the node move + Kueue removal; Track 3 persistence PVCs retarget to liskov's pool; note in Comment Log.
- `packages/docs/plans/2026-07-25_liskov-cluster-join.md` — Phase 3 becomes torvalds relaxation only (Kueue raise → removed instead); note removal happens at cutover.

**Live rollout (join-day runbook, single merge):** node Ready + pool created → merge #1629 → argocd sync → verify: builds create pods ON liskov, new buildkite Jobs are NOT suspended (`kubectl get jobs -n buildkite` spot-check), kueue-system namespace gone. Any Jobs left suspended from the transition: cancel/retry those builds (nothing will ever unsuspend them). Rollback: revert the kueue commit alone (label + controller + queues return together), or the whole PR (CI falls back to torvalds, Kueue restored). Update `src/talos/liskov/README.md` runbook steps accordingly.

---

## Verification

- Per commit: `bun run verify -- --affected` (includes `check:talos` validating both node pins post-move, helm-template renders without the kueue app, kueue-config test deleted with its subject).
- Commit A: `git check-ignore packages/homelab/src/talos/torvalds/patches/tailscale.yaml` (and liskov) both ignored; `bun src/talos/update-image-id.ts --check` green for both nodes.
- Commit B: `rg -i kueue` over the repo (excluding `packages/docs` history + changelogs) returns nothing load-bearing; the helm-types drift check confirms no kueue regeneration.
- End-to-end truth arrives on join day per the rollout runbook above (builds green on liskov with Kueue gone).

## Out of scope

- torvalds kubelet/ARC relaxation (existing Phase 3, post-soak evidence).
- Velero R2 prefix renames, pipeline step-shape changes (capacity plan Track 2).
