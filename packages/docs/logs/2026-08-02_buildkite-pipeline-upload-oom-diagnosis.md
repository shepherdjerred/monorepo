---
id: 2026-08-02_buildkite-pipeline-upload-oom-diagnosis
type: log
status: complete
board: false
---

# All PRs red — pipeline-upload memcg OOM diagnosis

## Symptom

Starting 2026-08-02 ~19:18 UTC, nearly every PR build fails at the bootstrap
`:pipeline: Upload pipeline` step with exit status `-7` and the agent message
"One or more containers connected to the agent, but then stopped communicating
without exiting normally. Perhaps the container was OOM-killed?". Build 7614
(19:07 UTC) was the last clean bootstrap; 7622 (19:18 UTC) was the first kill.
Failures are bursty — a few small builds passed (7668/7669, 7639, 7652–7664) —
and by ~23:00 UTC essentially every build died (7670–7682). `main` builds fail
too (7667 failed on release-please, but 7654's argocd-sync and the review-gate
failures on 7616/7618/7627/7637/7638/7660/7678 are separate issues).

## Root cause — three stacked causes, one fresh trigger

1. **Latent: the bootstrap pod's `container-0` cannot see the git mirror.**
   The tofu-managed bootstrap step (`packages/homelab/src/tofu/buildkite/pipeline.tf`)
   patches only the `checkout` container; unlike every pod anchor in
   `.buildkite/pipeline.yml`, it never mounts `buildkite-git-mirrors` into
   `container-0`. The checkout clones with `--reference` to the mirror, so
   `.git/objects/info/alternates` points at
   `/buildkite/git-mirrors/...-monorepo-git/objects` — a path that does not
   exist inside `container-0`. Every job log shows
   `error: unable to normalize alternate object path: …` at command phase.
   Consequence: the `git fetch --no-tags origin refs/heads/main…` in
   `.buildkite/scripts/upload-pipeline.sh` (changed-files base resolution)
   cannot use local history and downloads the **entire repo pack** — 653.70 MiB
   on Aug 1, 692.86 MiB on Aug 2. This has been happening silently on every PR
   build for a long time (confirmed in passing Aug 1 build 7525).

2. **Latent: a namespace LimitRange caps `container-0` at 768Mi, and the
   workspace is RAM-backed.** `container-0` in the bootstrap Job spec has
   `resources: {}`; the `buildkite-default-resources` LimitRange
   (argocd-tracked, created 2026-03-16) defaults it to `memory: 768Mi`. The
   agent-stack `workspace-volume` is `emptyDir: {medium: Memory, sizeLimit: 16Gi}`
   — tmpfs — so every byte git writes under `/workspace` is **shmem charged to
   container-0's 768Mi memcg**, not disk.

3. **Trigger: the repo pack outgrew the margin on Aug 2.** Kernel log on
   liskov (via `kubectl debug node`) shows repeated
   `Memory cgroup out of memory: Killed process … (git)` with
   `memory: usage 786432kB, limit 786432kB` and **`shmem 726519808` (~693 MiB)**
   — the fetched pack — plus ~70 MiB anon for git. Aug 1's 654 MiB pack +
   ~70 MiB fit under 768Mi by a hair; after `361510520` ("commit Gill Sans" —
   font binaries, merged 19:14:47 UTC) and other Aug 2 merges pushed the pack
   to ~693 MiB, the fetch crosses the limit and git is OOM-killed at the
   delta-resolution spike (~60s in, right after "Receiving objects: done").

The container dies mid-command → the agent reports the client "lost"
(exit `-7`) → the build fails before uploading any steps → the
`buildkite/monorepo/pr` status goes red on every PR.

Intermittent passes explained: on some builds git aborts the fetch early
(`fatal: bad object …` / "did not send all necessary objects" because local
refs point into the invisible mirror), the script's `fail_open` path kicks in,
schedules every path-gated lane, and the build proceeds normally.

## Red herrings eliminated

- **`activeDeadlineSeconds: 60` on failed Jobs is cleanup, not cause.** The
  agent-stack `completionsWatcher` patches the Job's deadline to
  `terminationGracePeriodSeconds` (60) _after_ the agent container terminates;
  the `DeadlineExceeded` events fire post-mortem. Build 7682's Job was created
  with the default 21600 and still died the same way at ~63s.
- Not a Buildkite timeout: pipeline/org timeouts are null; bootstrap step has
  `timeout_in_minutes: 5` (300s ≠ 60s).
- Not node pressure: liskov at ~27% memory, no DiskPressure, no evictions —
  the OOM is `CONSTRAINT_MEMCG` (container-level).
- Not the tofu apply / webhook-secret incident (PR #1926) — unrelated timing
  coincidence.

## Fix options (not applied this session)

1. **Mount the mirror into `container-0` of the bootstrap pod** (primary fix):
   in `pipeline.tf`'s step `podSpecPatch`, add `container-0` with the
   `buildkite-git-mirrors` readOnly volumeMount (the agent stack already adds
   the pod-level volume) — mirrors what every `.buildkite/pipeline.yml` pod
   anchor does per the "build 5694" comment. The fetch then transfers only the
   missing delta (KBs, not 700 MiB).
2. **Give bootstrap `container-0` explicit resources** so the LimitRange
   default never silently applies (e.g. the `pod_light` shape:
   requests 512Mi / limits a few Gi). Belt-and-braces alongside (1) — the
   pack will keep growing.
3. Optionally make `upload-pipeline.sh` fail loudly (or fall back open) when
   alternates are broken, so a 700 MiB fetch can never become the quiet
   steady state again.

Note `pipeline.tf` steps are applied to Buildkite by OpenTofu — merging the
change alone does not update the live pipeline; a `tofu apply` of the
`buildkite` stack is required (mind the webhook-secret freeze work in
PR #1926 touching the same stack).

## Session Log — 2026-08-02

### Done

- Root-caused the fleet-wide red PRs to a memcg OOM of the bootstrap
  `pipeline-upload` container (evidence chain: Buildkite job logs → k8s Job
  specs/events → agent-stack-k8s v0.46.3 source → liskov kernel log via
  `kubectl debug node`).
- Cleaned up the `node-debugger-*` pods used for kernel log access.

### Remaining

- Apply fix (1)+(2) in `packages/homelab/src/tofu/buildkite/pipeline.tf` and
  `tofu apply` the buildkite stack; verify a PR build's upload step no longer
  prints the alternates error and transfers only a small delta.
- Separate failures observed while investigating, not diagnosed here:
  review-gate failures (7616/7618/7627/7637/7638/7660/7678), `main` 7654
  argocd-sync, 7667 release-please.

### Caveats

- The 693 MiB full fetch has been silently burning ~700 MiB of GitHub egress
  per PR build since at least Aug 1 (likely much longer) — fixing the mirror
  mount also removes that.
- Kernel OOM kills at the container cgroup level produce **no** k8s events;
  don't rule out OOM because `kubectl get events` is clean.
