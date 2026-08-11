---
id: temporal-report-reliability
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Temporal report reliability

## Summary

Make every self-authored Temporal report a concise, evidence-backed heartbeat.
Known recurring checks use deterministic collectors; generic agents must declare
coverage and cite captured tool evidence. A report may claim a clean result only
when every required check completed successfully.

Schedules remain active. Empty-output suppression and automatic schedule
self-cancellation are removed.

## Implementation decisions

- Introduce a shared versioned report envelope with separate execution state and
  domain verdict, required-check coverage, findings, limitations, actions, and
  provenance. Subjects and rendering are deterministic; optional synthesis is
  evidence-backed and capped at 80 words.
- Centralize Postal delivery behind the report activity. Use a stable report run
  id, persist Postal acceptance receipts in S3, and treat delivery as at-least-once.
- Introduce agent-task contract v2 with declared checks and transcript-derived
  evidence receipts. New API and source-defined tasks require v2; Temporal replay
  retains a v1 compatibility path whose reports are explicitly partial.
- Replace stable recurring prompts with typed CI I/O, TaskNotes, protobuf, homelab,
  dependency, queue, and Data Dragon collectors. Keep agents only for bounded
  interpretation and novel investigations.
- Store dependency versions and management metadata in a language-neutral catalog.
  Build chronological change reports from the last accepted checkpoint, including
  upstream upgrades, internal promotions, additions, removals, and missing-note
  coverage.
- Monitor every declared and dynamic recurring report for a recent accepted
  heartbeat. Missing receipts become durable alerts and metrics; schedules are not
  paused or deleted automatically.

## Verification

- Unit tests cover report validation/rendering, subject derivation, redaction,
  delivery receipts, agent evidence validation, v1 replay, deterministic workflow
  outcomes, and dependency-history regressions.
- Focused Temporal, homelab, and root-script checks pass, followed by the root
  verification graph.
- Production canaries exercise complete, partial, and failed v2 reports. Each
  recurring report class must deliver a natural heartbeat before this plan is
  complete.

## Remaining

- [x] Implement the shared report contract, renderer, delivery receipts, metrics,
      and direct-send guard.
- [x] Add agent-task v2 evidence contracts and retain v1 replay compatibility.
- [x] Migrate every current email producer and recurring agent workflow.
- [x] Replace the version parser with a structured catalog and chronological
      dependency reporting.
- [x] Add report freshness monitoring and reconcile live-only schedules.
- [x] Update architecture, operator, API, and wiki documentation.
- [ ] Complete the root verification graph and address every failure.
- [ ] Deploy in compatibility order and run complete, partial, and failed
      production canaries.
- [ ] Observe one natural run of every daily and weekly report class before
      closing and archiving this plan.

## Comment Log

### 2026-08-10 — implementation started

- Approved after auditing the previous 30 days of self-sent agent email. The
  implementation preserves heartbeat visibility while eliminating unsupported
  clean claims and prose-first output.

### 2026-08-10 — source implementation and inventory complete

- The production read-only inventory at `2026-08-11T05:27:00Z` found no
  live-only self-authored schedules. The only source-only schedules were the
  new freshness monitor, protobuf watch, and TaskNotes canary awaiting rollout.
- The focused Temporal, cdk8s, homelab, and root-script graph passed all 19
  tasks. Renovate validated the configuration and extracted every one of the 94
  managed catalog entries; the 113 catalog values exactly match `origin/main`.
- Deployment, tagged production canaries, and natural-run observation remain
  operator-controlled acceptance work.

### 2026-08-10 — adversarial source review complete

- The final review corrected retry-inflated Scout warning counts, Kubernetes
  workload blind spots, Argo automation interpretation, Temporal failure-window
  filtering, and Buildkite's incomplete five-build sample. Buildkite now pages
  through every main build in the 24-hour window, inspects failed job logs, and
  treats a silent main pipeline as attention rather than clean.
- Agent finalization can no longer choose its verdict. Execution coverage,
  evidence success, finding severity, and optional skips determine the verdict
  deterministically. TaskNotes baseline evidence is compact, and every captured
  evidence excerpt is bounded by the report schema.
- Dependency regression coverage now uses the real July 6–13 catalog endpoints
  (20 managed upgrades, 13 other changed pins, 8 additions, and 4 digest-only
  changes). OCI notes authenticate to registry token services and inspect image
  config labels instead of relying on unauthenticated manifest annotations.
- The focused verification graph passed all 19 tasks, including 653 Temporal
  tests. The root graph completed 248 of 249 tasks; its only local failure was
  the Resume PDF build because `xelatex` is not installed on this machine. The
  dedicated Buildkite TeX lane remains the authoritative check, so the root and
  rollout checkboxes stay open until CI and production evidence exist.

### 2026-08-10 — report boundary review remediated

- The generic agent deployment now receives only provider auth and non-secret
  read-only evidence configuration. Provider subprocesses use an allowlist,
  redirect `HOME` into the throwaway clone, clone the public repository without
  GitHub auth, and dispatch report delivery to the credentialed core queue via
  a replay-safe Temporal patch.
- Retirement recommendations now require a complete passing CI I/O gate. Agent
  task identities include the full v2 check contract, and a post-delivery
  checkpoint failure gets a distinct stable failure-report identity so it
  cannot deduplicate behind the accepted dependency report.
- Replayed pre-migration agent histories retain their recorded agent-queue email
  activity but delegate delivery through a fixed core-queue workflow. This
  preserves Temporal determinism without restoring Postal or report-state S3
  credentials to the generic agent pod.
- The outer agent email activity now has a shared 10-minute completion budget,
  longer than the delegated workflow's complete three-attempt delivery window,
  so a slow accepted email cannot leave its parent agent workflow failed.
