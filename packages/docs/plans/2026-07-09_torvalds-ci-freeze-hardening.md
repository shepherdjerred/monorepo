# Torvalds CI-Freeze Hardening: Node / K8s / Dagger-Buildkite Protections

## Status

Partially Complete — all code/config changes implemented and merged to this PR. Talos
node-level rollout (watchdog, sysctls, kubelet podPidsLimit/enforceNodeAllocatable) is a
**manual operator step not yet performed** — see "Rollout for 1a–1d" below.

## Context

Between 2026-07-03 and 2026-07-07, the single-node Talos cluster `torvalds` suffered a
disk-full deadlock (07-03) and 7 full kernel hard-lockups (07-05 ×6, 07-07 ×1) requiring
physical power-cycle. Root cause, fully confirmed via Prometheus/Loki/Buildkite-API
cross-correlation (see `packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md`
and `packages/docs/logs/2026-07-05_torvalds-ci-freeze-investigation.md`):

- The single, shared Dagger CI engine (`dagger-dagger-helm-engine-0`) has **no CPU limit
  and no PID limit**. Bursts of concurrent CI sessions (9–31 observed) landing on it —
  worse when the build cache is cold, so every step does real uncached work — cause its
  goroutine/process count to explode (24→1164 goroutines in <60s) and drive host-wide
  `load1` into the thousands to tens of thousands (worst observed: 27,528). This is a
  genuine kernel scheduler runqueue lockup: unresponsive KVM/HDMI console, no keyboard
  input accepted, `kubectl`/`talosctl` both dead.
- Kubernetes' own self-preservation never engaged: `MemoryPressure` stayed `false`
  throughout every incident (kubelet only watches `MemAvailable` vs. a 2Gi threshold,
  which was never crossed even as the scheduler itself seized up).
- Existing concurrency caps (Buildkite `max-in-flight: 16`, Kueue's 7.5 CPU/16Gi quota)
  already bound how many CI job **pods get scheduled** — they do nothing to bound how much
  CPU/PID/memory any _single running_ pod (or the shared engine) can actually **consume**.
  Proof: the worst freeze (07-07, load1=16,147) happened with only 9 jobs running, nowhere
  near the 16-job cap — so tuning job-count alone (already tried once, 24→16) is a proven
  dead end.

The fix has to add **consumption caps**, not just admission caps, at three layers: the
node itself (so a future lockup self-recovers instead of requiring physical intervention),
Kubernetes cluster-wide (so no future workload can repeat this pattern by accident), and
the Dagger/Buildkite CI path specifically (the proximate cause).

**Two corrections made after user review of the first draft, both confirmed by direct
research/live-node verification, not assumption:**

1. **Dagger has zero native concurrency/session controls** — confirmed via research
   against Dagger's own docs, engine config schema, Helm chart, and GitHub
   issues/discussions: no session limit, no engine-side admission control, `configJson`
   only exposes `logLevel`/`security`/`gc`/`registries` (no BuildKit worker-parallelism
   passthrough), and horizontal engine scaling is a dead end (Dagger clients open multiple
   TCP connections per session with pod-local session state — a plain K8s Service's
   round-robin load balancing breaks sessions outright; confirmed via
   github.com/dagger/dagger#10128). **This means Buildkite's `max-in-flight` and Kueue's
   pod-count admission are not a "proxy" to be minimized — they are the _only_ lever that
   exists anywhere for bounding concurrent Dagger session count.** The user's point stands
   that Buildkite pods themselves are lightweight and Dagger is what actually consumes
   resources — but the admission-count layer and the consumption-cap layer (CPU/PID limits
   on the engine, below) are complementary, not redundant: one bounds _how many_ sessions
   can exist, the other bounds _how much damage_ each one can do. Both are needed; neither
   substitutes for the other. Since consumption caps are now landing (Layer 3), the
   `max-in-flight: 16` limit — set from panic during the incident, not from data — can be
   restored to `24`, which ran without issue for a long time before this incident (see 3c).

2. **The node-level auto-recovery approach in the original draft was wrong.** Live-verified
   on the node (`talosctl -n torvalds read /proc/sys/kernel/hung_task_timeout_secs` etc.):
   `hung_task_timeout_secs`/`hung_task_panic` **do not exist on this kernel**
   (`CONFIG_DETECT_HUNG_TASK` isn't compiled into Talos's kernel — same for
   `softlockup_panic`/`nmi_watchdog`/`hardlockup_panic`, all absent). Even if they existed,
   they wouldn't have matched this failure: the hung-task detector only watches D-state
   (blocked-on-I/O) tasks, and this investigation's own data showed `node_procs_blocked`
   stayed at ~0 throughout every freeze while `node_procs_running` (R-state,
   runnable-but-starved) spiked to 476 — this was pure runqueue/scheduling contention, not
   a kernel hang or panic condition. Linux does not consider "extremely high load average"
   an error state, so no panic-on-X sysctl fires for it — the kernel is technically still
   "working," just so overloaded nothing (including console/keyboard input) gets scheduled.
   Also found: Talos **already ships `kernel.panic=10` and `kernel.panic_on_oops=1` by
   default** (verified live) — genuine panics already auto-reboot; no action needed there.
   The mechanism that actually fits this failure mode is a **watchdog** (hardware or
   software) — its heartbeat comes from an external/periodic ping, not from the kernel
   correctly self-diagnosing an error, so it fires precisely because the pinging process
   itself starves under the same overload that froze everything else. See revised 1a below.

**Ship as a single PR.** All items below land together; a few require a manual operator
step after merge (Talos machine-config patches don't auto-apply via GitOps — see Rollout).

---

## Layer 1 — Node (Talos)

### 1a. Watchdog — the primary auto-recovery mechanism for this failure mode

**This replaces the hung-task-panic approach from the first draft**, which live-verification
proved would have been a no-op that also wouldn't have matched the failure mode even if it
worked (see Context corrections above). A watchdog is architecturally correct here because
it doesn't require the kernel to self-diagnose an error — it requires a periodic heartbeat
from a userspace/kernel process, and that process starves under the exact same runqueue
exhaustion that froze everything else, so a missed heartbeat reliably indicates "system is
non-functional" regardless of whether any formal panic/oops/hang condition was ever hit.

**Investigate feasibility first, then implement** (concrete steps, not deferred
indefinitely — do this as part of this PR's rollout, before or right after merge):

```bash
talosctl -n torvalds get watchdogtimerconfig      # Talos's own watchdog resource, if any exists
talosctl -n torvalds get watchdogtimerstatus
lspci -k | grep -i "ISA bridge\|LPC"               # check for Intel TCO chipset (iTCO_wdt)
```

If hardware TCO support is present (plausible on this Z790-class board but unverified),
configure it via `machine.kernel.modules` + a `WatchdogTimerConfig` resource:

```yaml
machine:
  kernel:
    modules:
      - name: iTCO_wdt
        parameters: ["heartbeat=60", "nowayout=1"]
      - name: iTCO_vendor_support
---
apiVersion: v1alpha1
kind: WatchdogTimerConfig
device: /dev/watchdog0
timeout: 3m0s
```

If hardware TCO support is **not** present, fall back to the `softdog` kernel module
(software-emulated watchdog device, no chipset dependency — still meaningfully protective
here since it depends on a kernel timer/softirq being serviced, which degrades far less
severely under process-scheduling contention than plain userspace scheduling does):

```yaml
machine:
  kernel:
    modules:
      - name: softdog
---
apiVersion: v1alpha1
kind: WatchdogTimerConfig
device: /dev/watchdog0
timeout: 3m0s
```

**Verify before relying on this**: confirm what actually pets the watchdog once armed (Talos's
own `machined`/init process is the expected petter — if so, this is exactly the desired
behavior, since `machined` itself would starve under the same overload that killed
everything else, correctly triggering a reset). Do not assume this without checking
`talosctl get watchdogtimerstatus` shows an active petting cycle post-configuration.

### 1b. Cheap, zero-risk bonus signal — `packages/homelab/src/talos/patches/sysctls.yaml`

```yaml
machine:
  sysctls:
    kernel.kptr_restrict: "1"
    kernel.panic_on_rcu_stall: "1"
```

`panic_on_rcu_stall` **exists on this kernel** (live-verified, currently `0`). Under severe
runqueue pressure, RCU grace-period processing can also stall (it runs in softirq context,
somewhat more resilient than plain process scheduling, but not immune) — enabling this
costs nothing and might catch an escalating event before it reaches the extremes observed
here. Not a guaranteed catch (RCU softirqs can still get serviced occasionally even amid
severe R-state pileup), so this is a bonus layer, not the primary mechanism — 1a is.
`kernel.panic` and `kernel.panic_on_oops` are **already set by Talos by default** (verified
live: `panic=10`, `panic_on_oops=1`) — no action needed for either.

Update `packages/homelab/src/talos/README.md`'s `sysctls.yaml` section to document this,
following the existing entry's style (setting description + "Applied: \<date>" note).

### 1c. Cluster-wide fork-storm cap — `packages/homelab/src/talos/patches/kubelet.yaml`

Add to `machine.kubelet.extraConfig`:

```yaml
podPidsLimit: 4096
```

`4096` is the standard Kubernetes-documented default for clusters that set this field
(more restrictive CIS-hardening guidance of 1024 targets adversarial multi-tenant
threat models, not this single-trusted-workload homelab). No per-pod override exists in
Kubernetes — this is a single kubelet-wide value, so it must accommodate the Dagger
engine's own legitimate multi-process needs, not just an average pod. 4096 sits well above
any plausible legitimate concurrent-session footprint while still being a hard, finite
ceiling — the whole point is that the 24→1164 goroutine explosion (and the accompanying
`node_procs_running` spike to 476 system-wide) hits a wall instead of continuing unbounded.

**Verify before merge is meaningful** (not blocking the PR, but do this before flipping the
value live): sample real PID/process count inside the Dagger engine's cgroup during a
healthy heavy-concurrency run once 3a below (engine CPU limit) is live, to confirm 4096
has real headroom. After rollout, watch for `PIDPressure` node conditions or PID-limit
pod failures anywhere in the cluster for the following weeks.

### 1d. Real cgroup ceilings for reserved capacity — same file, `extraConfig`

```yaml
enforceNodeAllocatable: ["pods", "system-reserved", "kube-reserved"]
```

Currently the kubelet only enforces the default (`["pods"]`). Adding `system-reserved`/
`kube-reserved` gives those existing reservations (`systemReserved: cpu 4/memory 56Gi`,
`kubeReserved: cpu 1/memory 2Gi`, already in this file) real cgroup ceilings — protecting
kubelet/containerd/etcd/apid from being starved by pod-side pressure. Lower risk than 1c:
the reservations were already sized generously and assumed load-bearing; this just makes
that assumption actually enforced.

### Rollout for 1a–1d (manual operator step, not GitOps)

Per `packages/homelab/src/talos/README.md`, Talos machine-config patches are **not**
applied automatically by ArgoCD/Tofu — merging the PR stages the file but does nothing to
the live node until run manually:

```bash
talosctl patch machineconfig --patch @src/talos/patches/sysctls.yaml
talosctl patch machineconfig --patch @src/talos/patches/kubelet.yaml
```

Then verify live effect rather than assuming it (the README's precedent for
`kptr_restrict` states "no reboot needed," but that's a genuinely live-writable
`/proc/sys` knob — `panic_on_rcu_stall` and the kubelet `extraConfig` fields may only take
effect at kernel/kubelet startup):

```bash
talosctl -n torvalds read /proc/sys/kernel/panic_on_rcu_stall
talosctl -n torvalds get watchdogtimerstatus   # confirm the watchdog from 1a is armed + being petted
talosctl -n torvalds get kubeletconfig         # confirm podPidsLimit / enforceNodeAllocatable applied
```

If any value didn't take live, `talosctl reboot` is required. Document the actual finding
in the README (same style as the existing entries) so this doesn't need re-discovery next
time.

---

## Layer 2 — Kubernetes (cluster-wide)

### 2a. Buildkite namespace default limits — `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts` (~line 53-66)

```ts
new KubeLimitRange(chart, "buildkite-limit-range", {
  metadata: { name: "buildkite-default-resources", namespace: "buildkite" },
  spec: {
    limits: [
      {
        type: "Container",
        defaultRequest: {
          cpu: Quantity.fromString("50m"),
          memory: Quantity.fromString("64Mi"),
        },
        default: {
          cpu: Quantity.fromString("400m"),
          memory: Quantity.fromString("768Mi"),
        },
      },
    ],
  },
});
```

`default` is the correct `LimitRangeItem` field for default _limits_ (confirmed against
standard Kubernetes API — `KubeLimitRange` in `packages/homelab/src/cdk8s/generated/imports/k8s.ts:197`
wraps this 1:1; a wrong field name would fail TypeScript compilation, so this is
self-checking). This only backstops containers that don't set their own limits (sidecars);
step containers get explicit limits via 3a/3b below. Rewrite the existing comment ("so
containers can burst freely" — no longer true).

### 2b. Kueue pod-count backstop — `packages/homelab/src/cdk8s/src/resources/kueue-config.ts` (~line 37-56)

Per the correction above, Buildkite's `max-in-flight` is the _real_ control (the only lever
that exists anywhere for Dagger session count) — Kueue's role here is a cheap, independent
second enforcement point in case `max-in-flight` ever regresses (e.g. a future Helm-values
typo), not a primary control in its own right:

```ts
resourceGroups: [
  {
    coveredResources: ["cpu", "memory", "pods"],
    flavors: [
      {
        name: "default",
        resources: [
          { name: "cpu", nominalQuota: "7500m" },
          { name: "memory", nominalQuota: "16Gi" },
          { name: "pods", nominalQuota: "24" },
        ],
      },
    ],
  },
],
```

`pods: "24"` mirrors the restored `max-in-flight: 24` (see 3c) exactly. **No change to the
existing CPU/memory nominal quota** — Kueue admission accounting is always requests-based
(fixed Kueue behavior, not a config choice), and 7500m/16Gi remains correctly scoped against
the small per-step requests (24 jobs × ~250m HEAVY-tier request ≈ 6000m, comfortably under
the 7500m quota — no retune needed). Keep `preemption: Never/Never` — this is a
single-queue, single-node cluster; no cohort/borrowing machinery needed.

Add `packages/homelab/src/cdk8s/src/resources/kueue-config.test.ts` (no existing test file
for this resource): assert `coveredResources` includes `"pods"` and that the `pods`
quota equals Buildkite's `max-in-flight` (import both, assert equality) — directly
prevents future drift between the two caps, matching this repo's existing lockstep-value
testing pattern (e.g. the ARC-vs-`systemReserved` note in `zfs.yaml`).

### 2c. Kyverno resource-limit backstop — `packages/homelab/src/cdk8s/src/resources/kyverno-policies.ts`

Add a new exported function (same `ApiObject`-based pattern as the existing
`createVeleroBackupLabelPolicy`), wired into
`packages/homelab/src/cdk8s/src/cdk8s-charts/kyverno-policies.ts` alongside the existing
call:

```ts
export function createResourceLimitEnforcementPolicy(chart: Chart) {
  return new ApiObject(chart, "resource-limit-enforcement-policy", {
    apiVersion: "kyverno.io/v1",
    kind: "ClusterPolicy",
    metadata: { name: "enforce-container-resource-limits" },
    spec: {
      // Audit only for now — report violations without blocking. Flip to
      // Enforce in a follow-up once 3a/3b's explicit limits make this a
      // true no-op backstop and Audit-mode PolicyReports show zero drift.
      validationFailureAction: "Audit",
      background: true,
      rules: [
        {
          name: "require-cpu-memory-limits",
          match: {
            any: [
              {
                resources: {
                  kinds: ["Pod"],
                  namespaces: ["dagger", "buildkite"],
                },
              },
            ],
          },
          validate: {
            message:
              "Containers in dagger/buildkite namespaces must set cpu and memory limits (2026-07 CI-freeze hardening).",
            pattern: {
              spec: {
                containers: [
                  { resources: { limits: { cpu: "?*", memory: "?*" } } },
                ],
              },
            },
          },
        },
      ],
    },
  });
}
```

Scoped to `dagger`/`buildkite` namespaces only (not cluster-wide — this is a 160+ pod
cluster; don't risk surprising unrelated workloads) and **Audit mode**, not a mutating
rule (a mutating rule would silently inject limits rather than surfacing what's missing —
avoid the "just-in-case" catch-all this repo's conventions explicitly discourage). Ships
via the already-automated `kyverno-policies` ArgoCD Application — no manual step.

Add `packages/homelab/src/cdk8s/src/resources/kyverno-policies.test.ts`: assert
`validationFailureAction` is `"Audit"` and the namespace scope, so a future accidental
flip to `Enforce` or scope-widening doesn't ship silently.

---

## Layer 3 — Dagger / Buildkite

### 3a. Dagger engine CPU limit — `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts` (~line 280-287)

```ts
resources: {
  requests: { cpu: "6", memory: "16Gi" },
  limits: { cpu: "16", memory: "50Gi" },
},
```

**The single most direct fix.** The file's own existing comment records a 30-day observed
peak of 4.6 CPU; `16` is ~3.5× that — enough headroom that legitimate heavy concurrent
bursts aren't throttled, while bounding the worst-case scheduler runqueue pressure this one
container can cause to a finite 16-core slice instead of unbounded. Leaves 11 of the 27
pod-allocatable cores for everything else running concurrently. Rewrite the adjacent "no
CPU limit on purpose" comment — cite this investigation, it's no longer accurate.
Ships via the existing automated `dagger` ArgoCD Application; a `resources.limits` change
recreates the StatefulSet pod on normal reconcile — no manual `rollout restart` needed
(that's only required for the separate `configJson`-mounted GC config, per the existing
comment in the same file — call this distinction out in the PR description).

### 3b. CI step container limits — `scripts/ci/src/catalog.ts` (~line 415-417) + `scripts/ci/src/lib/k8s-plugin.ts` + call sites

Add a parallel LIMIT tier next to the existing REQUEST tiers in `catalog.ts`:

```ts
const HEAVY: ResourceTier = { cpu: "250m", memory: "768Mi" };
const MEDIUM: ResourceTier = { cpu: "150m", memory: "512Mi" };
const LIGHT: ResourceTier = { cpu: "100m", memory: "384Mi" };

// CI step wrapper containers do thin Dagger-CLI-call work (the real compute
// happens in the remote engine, capped separately by 3a) — usage should track
// request closely, so limits use a fixed multiplier rather than a separately
// tuned tier. CPU multiplier > memory multiplier: log-streaming/wrapper
// processes burst CPU more than memory.
const HEAVY_LIMIT: ResourceTier = { cpu: "1", memory: "1536Mi" };
const MEDIUM_LIMIT: ResourceTier = { cpu: "600m", memory: "1024Mi" };
const LIGHT_LIMIT: ResourceTier = { cpu: "400m", memory: "768Mi" };
```

**Before merging, validate the multiplier against real usage** (not an arbitrary
round-number pick): query `quantile_over_time(0.99, container_cpu_usage_seconds_total{namespace="buildkite"}[7d])`
and the memory equivalent in Prometheus, covering a window that includes a "build
everything" run, and adjust the tiers so p99 sits comfortably under the new limits.

Wire limits through: `k8sPlugin()` in `scripts/ci/src/lib/k8s-plugin.ts` (~line 74-95)
needs `cpuLimit`/`memoryLimit` options alongside the existing `cpu`/`memory` request
options, added to the container `resources.limits` block. The call chain feeding it is
`scripts/ci/src/steps/per-package.ts`: `perPackageSteps()` (line 58) resolves
`PACKAGE_RESOURCES[pkg] ?? DEFAULT_RESOURCES`, which flows into `daggerCallStep()`
(line 265-285, currently typed `resources: { cpu: string; memory: string }`) which calls
`k8sPlugin({ cpu: resources.cpu, memory: resources.memory })` (line 279). Widen
`daggerCallStep`'s `resources` parameter type to include `cpuLimit`/`memoryLimit` (or
simplest: add those fields directly to the `ResourceTier` type in `catalog.ts` and thread
the whole object through, since every call site already passes a full tier object) and
update the `k8sPlugin(...)` call to pass them through. Check for other functions in
`per-package.ts` with the same `resources: { cpu: string; memory: string }` signature
(e.g. `tasksForObsidianNativeDepsStep`) — apply the same widening consistently.

Extend `scripts/ci/src/__tests__/k8s-plugin.test.ts` with cases asserting
`resources.limits.cpu`/`resources.limits.memory` for both default and custom-override
paths, following the existing test's exact structure (destructure
`plugin["kubernetes"].podSpecPatch.containers[0].resources`).

### 3c. `max-in-flight` — restore to `24`

`packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts` (~line 121):
`"max-in-flight": 24` (currently `16`).

The 16 value was set _during_ the incident response, from panic, not from data — and per
the Context correction above, since Dagger has zero native concurrency control, this
Buildkite-side setting is the _only_ lever for session count anywhere in the stack, so
tuning it down was the only knob available at the time. But the 07-07 freeze happened at
only 9 running jobs (nowhere near even 16), proving job-count alone was never the real
constraint — consumption per session was. `24` ran without incident for a long time before
this event; the actual fix is the consumption caps landing in 3a/3b (bounding what each of
those 24 jobs, and the shared engine backing them, can consume) plus 1a's watchdog
(catching it if a burst still gets through). Restoring throughput here is intentional, not
a compromise — the new caps are what make 24 safe again, not a live re-guess at a "safer"
number. Update the Kueue `pods` quota in 2b to match (`24`, already done above).

---

## Layer 4 (cross-cutting) — Fast detection

### 4a. `node_load1` alert — `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/resource-monitoring.ts`

The existing `UnusualSystemLoad` alert uses `node_load15` with a 15-minute `for:` — too
slow; the worst observed ramp went from load=5 to load=1300 in under 8 minutes. Add:

```ts
{
  alert: "CriticalSystemLoad",
  annotations: {
    summary: "Node load1 critically high — imminent scheduler lockup risk",
    description: escapePrometheusTemplate(
      "Node {{ $labels.instance }} node_load1 is {{ $value }}, far above CPU thread count. " +
      "This pattern preceded every 2026-07 kernel hard-lockup freeze. Consider killing " +
      "in-flight Buildkite builds now — kubectl/talosctl may stop responding within minutes. " +
      "Investigation: packages/docs/logs/2026-07-05_torvalds-ci-freeze-investigation.md",
    ),
  },
  expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
    'node_load1 > 8 * count by (instance) (node_cpu_seconds_total{mode="idle"})',
  ),
  for: "2m",
  labels: { severity: "critical" },
},
```

`8×` core count (= load1 > 256 on this 32-thread box) sits well above legitimate heavy-CI
peaks (CPU% maxed ~93% during past healthy heavy bursts, not the multiples-of-thread-count
range seen in actual incidents) and well below the catastrophic range — a reasoned
starting point, not a final answer. `for: 2m` matches the observed ramp speed while
filtering single-scrape noise. Ship only the critical tier initially — the 07-03
postmortem explicitly notes pages "buried in an alert storm" as a real failure mode; adding
a lower-severity warning tier later, once there's a baseline, avoids repeating that.

Add `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/resource-monitoring.test.ts`
(no existing test file), following the `rules/velero.test.ts` pattern: call
`getResourceMonitoringRuleGroups()`, find the alert by name, assert the `expr` and `for`.

**Verify via backtest before considering the threshold final**: query `node_load1` history
in Grafana across the 07-05/07-07 incident windows to confirm the alert would have fired
with real lead time, and across a known-healthy heavy-CI window to confirm no
false-positive.

---

## Summary of files touched

| File                                                                                                      | Change                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `packages/homelab/src/talos/patches/sysctls.yaml` (+README)                                               | `panic_on_rcu_stall`                                |
| new/existing Talos patch (watchdog config, file TBD by 1a feasibility check) (+README)                    | `iTCO_wdt`/`softdog` module + `WatchdogTimerConfig` |
| `packages/homelab/src/talos/patches/kubelet.yaml` (+README)                                               | `podPidsLimit`, `enforceNodeAllocatable`            |
| `packages/homelab/src/cdk8s/src/resources/argo-applications/buildkite.ts`                                 | LimitRange `default`, `max-in-flight` 16→24         |
| `packages/homelab/src/cdk8s/src/resources/kueue-config.ts` (+new test)                                    | `pods` covered resource + quota (24)                |
| `packages/homelab/src/cdk8s/src/resources/kyverno-policies.ts` (+new test)                                | Audit-mode limit-enforcement policy                 |
| `packages/homelab/src/cdk8s/src/cdk8s-charts/kyverno-policies.ts`                                         | wire new policy in                                  |
| `packages/homelab/src/cdk8s/src/resources/argo-applications/dagger.ts`                                    | engine `limits.cpu: "16"`                           |
| `scripts/ci/src/catalog.ts`                                                                               | `*_LIMIT` tiers                                     |
| `scripts/ci/src/lib/k8s-plugin.ts` (+test)                                                                | `cpuLimit`/`memoryLimit` opts                       |
| `scripts/ci/src/steps/per-package.ts`                                                                     | widen `resources` type, thread limits through       |
| `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/resource-monitoring.ts` (+new test) | `CriticalSystemLoad` alert                          |

## Verification

1. `bun run typecheck && bun run test` (root) — catches any generated-type field-name
   mistakes (e.g. `LimitRangeItem.default`) at compile time, runs all new/updated tests.
2. `cd packages/homelab && bun run build` then `HELM_RENDER_TEST=1 bun test src/argocd-helm-render.test.ts` —
   confirms every synthesized manifest (dagger, buildkite, kueue, kyverno-policies) still
   renders and schema-validates.
3. Pre-merge data checks (not blocking, but do before finalizing exact numbers):
   - `quantile_over_time(0.99, container_cpu_usage_seconds_total{namespace="buildkite"}[7d])` /
     memory equivalent — validates the 3b limit multipliers against real usage.
   - Backtest `node_load1` over the 07-05/07-07 windows and a known-healthy heavy-CI
     window — validates the 4a threshold.
4. Before writing the watchdog config (1a): run the feasibility check
   (`talosctl -n torvalds get watchdogtimerconfig`, `lspci -k | grep -i "ISA bridge\|LPC"`)
   to determine hardware (iTCO) vs. software (softdog) path.
5. After merge: run the `talosctl patch machineconfig` commands (Layer 1 rollout — sysctls,
   watchdog, kubelet), then the `talosctl read`/`get watchdogtimerstatus`/`get kubeletconfig`
   live-effect checks, rebooting if needed. Confirm the watchdog is actually being petted
   (not just armed) before trusting it.
6. Post-rollout, over the following 1–2 weeks: watch for (a) any `CriticalSystemLoad`
   false-positive fires during normal heavy CI, (b) any `PIDPressure` node condition or
   PID-limit pod failures anywhere in the cluster, (c) Kyverno `PolicyReport` violations in
   `dagger`/`buildkite` namespaces to confirm 3a/3b's explicit limits made the Audit policy
   a true no-op — informs whether to flip it to `Enforce` in a follow-up, (d) whether the
   restored `max-in-flight: 24` reproduces any elevated-load pattern in the new
   `CriticalSystemLoad` alert — if so, that's real data to act on, unlike the prior guess.

## Session Log — 2026-07-09

### Done

- Implemented all four layers as a single PR in worktree `feature/ci-freeze-hardening`:
  - **Layer 1 (node/Talos)**: `packages/homelab/src/talos/patches/watchdog.yaml` (new —
    `iTCO_wdt` kernel module + `WatchdogTimerConfig`, feasibility confirmed live on
    `torvalds`: `/sys/class/watchdog/watchdog0` already exists with `identity=iTCO_wdt`);
    `sysctls.yaml` (`kernel.panic_on_rcu_stall`); `kubelet.yaml` (`podPidsLimit: 4096`,
    `enforceNodeAllocatable: [pods, system-reserved, kube-reserved]`); `README.md` updated
    for all three.
  - **Layer 2 (K8s cluster-wide)**: `buildkite.ts` (`LimitRange.default` limits,
    `max-in-flight` 16→24 via new exported `BUILDKITE_MAX_IN_FLIGHT` constant);
    `kueue-config.ts` (`pods` covered resource, quota locked to
    `BUILDKITE_MAX_IN_FLIGHT`, +new test asserting lockstep); `kyverno-policies.ts` (new
    Audit-mode `createResourceLimitEnforcementPolicy`, scoped to `dagger`/`buildkite`,
    wired into `cdk8s-charts/kyverno-policies.ts`, +new test).
  - **Layer 3 (Dagger/Buildkite)**: `dagger.ts` (`resources.limits.cpu: "16"`);
    `catalog.ts` (`ResourceTier` extended with `cpuLimit`/`memoryLimit`, all three
    tiers given tier-appropriate limit values); `k8s-plugin.ts` (`cpuLimit`/`memoryLimit`
    opts, defaulted to LIGHT-tier values so every one of the ~25 `k8sPlugin()` call sites
    gets a default limit, not just the ones threading a tier through); `per-package.ts`
    (three functions widened from inline `{cpu,memory}` types to the shared
    `ResourceTier`, all `k8sPlugin()` calls updated to pass limits through); extended
    `k8s-plugin.test.ts` with default/custom limit assertions.
  - **Layer 4 (fast detection)**: `resource-monitoring.ts` (`CriticalSystemLoad` alert on
    `node_load1 > 8×cores` for `2m`, next to the existing slower `UnusualSystemLoad`);
    +new `resource-monitoring.test.ts`.
- Verified: `bun run typecheck` (all packages, 0 errors) and `bun run test` (root, exit 0
  — homelab cdk8s: 163 pass/0 fail incl. all new tests) both clean.
  `HELM_RENDER_TEST=1 bun test src/argocd-helm-render.test.ts`: 16/16 pass after priming
  the local helm repo cache (8 unrelated external charts failed on the first run with
  "no cached repo found" — a local-environment cache-miss issue, not caused by this
  change; confirmed by the fact `dagger`/`buildkite`/`kueue`/`kyverno`, the 4 charts
  actually touched, were never in the failure list even before priming the cache).
- Reverted an incidental `packages/temporal/bun.lock` diff produced by
  `scripts/setup.ts`/`bun install` during worktree setup — unrelated to this change,
  not committed.
- Mirrored the approved harness plan into this file per repo convention.

### Remaining

- **Manual operator step, not yet performed**: after this PR merges and ArgoCD syncs the
  K8s-level changes, someone with `talosctl` access to `torvalds` must run the Layer 1
  rollout — `talosctl patch machineconfig --patch @src/talos/patches/sysctls.yaml` and
  `--patch @src/talos/patches/kubelet.yaml`, then separately and carefully apply
  `watchdog.yaml` (it's two documents — a `machine.kernel.modules` patch plus a standalone
  `WatchdogTimerConfig` resource; do not fold into a bulk patch invocation). Then verify
  live effect per the checks listed in "Rollout for 1a–1d" above — do not assume any of
  these took effect without checking, and update the README's "Applied: _(fill in...)_"
  placeholders with the actual date and findings once done.
- Pre-merge data validation the plan calls out as advisable but not blocking (can be done
  before or shortly after merge): backtest `node_load1` in Grafana across the 07-05/07-07
  incident windows to confirm `CriticalSystemLoad` would have fired with real lead time;
  query real p99 CPU/memory usage for `buildkite`-namespace containers to sanity-check the
  Layer 3b limit multipliers against actual usage rather than the reasoned-but-unverified
  starting values currently in `catalog.ts`.
- Post-rollout 1–2 week observation window per item 6 above (false-positive check on the
  new alert, PID-pressure check, Kyverno PolicyReport review, `max-in-flight: 24`
  reproduction check) — not something to do now, a note for whoever revisits this.

### Caveats

- The `podPidsLimit: 4096` and Kyverno Audit-mode policy are the two highest-risk items in
  this PR (cluster-wide / could affect any of the 160+ pods on the node) — they're
  deliberately conservative (Audit not Enforce; 4096 is the upstream-standard default, not
  a tight custom value) but genuinely unverified against real PID counts under heavy load.
  Do not tighten either without the verification steps above.
- I did not run `talosctl patch machineconfig` against the live node during this session —
  Talos machine-config changes are a real, hard-to-reverse-quickly infrastructure mutation
  (a bad watchdog config reboots the box), so per this repo's risk posture that's an
  explicit follow-up for the user/operator, not something to do unprompted from a coding
  session.
