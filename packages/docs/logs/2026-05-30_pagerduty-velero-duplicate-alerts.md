# PagerDuty — Velero "Large PVC" duplicate/garbled alerts

## Status

Complete (code fix); post-deploy verification deferred — see [todos/pagerduty-velero-alert-formatting](../todos/pagerduty-velero-alert-formatting.md).

## Context

Triaging open PagerDuty incidents (all on the **Homelab** service, 8 triggered). They collapsed into 4 real issues; this log covers the first:

- **#5262–#5266** — five "Large PVC may impact Velero backups\n\n 🔥" incidents fired in a 5-minute window on 2026-05-29 21:32–21:37. #5264 had the summary text _tripled_. Every title ended in a literal `\n\n`.

The other three open issues (not addressed here): #5274 SSD wear (`nvme1n1` writing 1.5→4 TB/24h), #5275 `runVacuumIfNotHome` skipped 5 days, #5296 62 HA entities unavailable (likely the root cause of #5275).

## Root cause

The Prometheus rule `VeleroLargePVCMayImpactBackups`
([velero.ts:25](../../homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/velero.ts#L25))
is fine. The bug was entirely in the Alertmanager → PagerDuty `description`
template at
[prometheus.ts:192](../../homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts#L192):

```js
String.raw`{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}\n{{ end }}`;
```

Two defects:

1. **Literal `\n`.** `String.raw` keeps `\n` as the two characters backslash-n.
   Go's `text/template` does not interpret backslash escapes in literal template
   text (only inside quoted action strings like `{{ "\n" }}`), so PagerDuty
   received a literal `\n` — exactly the `...backups\n\n` seen in every title.

2. **Wrong annotation key.** The template read `.Annotations.description`, but the
   Velero rules (and every `message`-based rule family) define `.Annotations.message`,
   not `description`. So the per-alert detail (which PVC, what size, which
   namespace) never reached PagerDuty. All five incidents rendered as the bare
   static `summary`, making distinct PVCs/namespaces look like duplicates. The
   "tripled" #5264 was simply a namespace with 3 large PVCs grouped into one
   incident (`group_by: [namespace, alertname]`), each contributing an identical
   bare summary.

These were **not** true duplicates — they were 5 distinct namespaces/PVCs
rendered indistinguishably because the detail was dropped.

## Fix

Replaced the description template with a normal template literal (so `\n` is a
real newline) that includes the namespace inline and falls back from `.message`
to `.description`:

```js
`{{ range .Alerts }}{{ .Annotations.summary }}{{ if .Labels.namespace }} ({{ .Labels.namespace }}){{ end }}: {{ if .Annotations.message }}{{ .Annotations.message }}{{ else }}{{ .Annotations.description }}{{ end }}\n{{ end }}`;
```

Post-Helm, Alertmanager now renders, per alert:

```
Large PVC may impact Velero backups (immich): PVC immich/immich-data requests 412GiB. kube-state-metrics is not exporting velero.io labels, so review the PVC backup policy manually.
```

Distinct per namespace, real detail, no literal `\n`.

Also strengthened the E2E test
([helm-template.test.ts:172](../../homelab/src/cdk8s/src/helm-template.test.ts#L172))
to assert the rendered output references `.Annotations.message` and
`.Labels.namespace`, and to reject the literal `{{ .Annotations.summary }}\n`
pattern.

## Verification

- `bun run --filter='./packages/homelab' typecheck` — passes.
- Verified the escaping round-trip two ways: `escapeHelmGoTemplate` output, when
  un-escaped the way Helm does, exactly reproduces the intended template; the
  executed template contains a real newline (not backslash-n) and references
  `.Annotations.message` / `.Labels.namespace`.
- Could **not** run locally: the helm-template E2E test (`helm` not installed),
  cdk8s synth (pre-existing Windows `/C:/...` path bug in `src/app.ts`), and
  ESLint (flat config `@shepherdjerred/eslint-config` not built in this worktree —
  fails identically on unchanged files). These need a Linux/CI environment or a
  full `bun run scripts/setup.ts`.

## Codebase sweep — "same mistake elsewhere?"

After fixing the one template, swept the repo for the same two mistakes. **No
other instances.**

**Mistake A — literal `\n` in a Go `text/template`.** The literal-`\n` only bites
when the string is (1) built so the `\n` stays a literal backslash-n (i.e. via
`String.raw`, not a normal/template literal where JS converts `\n` to a real
newline) AND (2) consumed by Go's `text/template` (Alertmanager / Prometheus /
event-exporter). Searched every `String.raw` in the monorepo: the only one that
was also a Go template was the PagerDuty description (fixed). Every other
`String.raw` is a regex/sed/Ruby/PEM string. All other `\n` in notification
templates use real newlines via normal literals and are correct:

- `rules/homeassistant.ts:162` — `description` uses real `\n` (normal template literal). Correct.
- `rules/temporal.ts:233` — real `\n` inside a multi-line PromQL expr. Correct.
- `monitoring/kubernetes-event-exporter.ts` — Go templates reference `.InvolvedObject.*` / `.Reason`; no `\n`, no annotation refs. Correct.
- `grafana-values.ts` — no inline Go-template notification strings.

**Mistake B — referencing an annotation key the rules don't populate.** The only
notification template that consumes `.Annotations.*` is the PagerDuty description
(fixed; now `message` with `description` fallback). Verified the fallback is
complete: across all rule files the detail-bearing annotation keys are `summary`
(207), `description` (140), `message` (67), and a single `runbook_url` — and that
`runbook_url` rule (HA entities, the one behind #5296) also defines `description`.
So no alert can page with a bare summary anymore.

## Session Log — 2026-05-30

### Done

- Diagnosed PagerDuty incidents #5262–#5266 as a single Alertmanager template bug
  (literal `\n` + wrong annotation key), not five duplicates.
- Fixed the PagerDuty `description` template in
  `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts`.
- Added regression assertions in
  `packages/homelab/src/cdk8s/src/helm-template.test.ts`.
- typecheck verified; escaping round-trip verified manually.
- Swept the whole repo for the same two mistakes (literal `\n` in Go templates;
  wrong annotation key) — confirmed the PagerDuty description was the only
  instance of each. See "Codebase sweep" section above.

### Remaining

- Run `cd packages/homelab && bun run test` (cdk8s helm E2E) in CI/Linux to
  confirm the rendered chart, then deploy and verify a real Velero PVC incident
  in PagerDuty shows the namespace + size with no literal `\n`. Tracked in
  `packages/docs/todos/pagerduty-velero-alert-formatting.md`.
- Resolve the 4 stale duplicate incidents (#5263–#5266) in PagerDuty, keeping
  one — needs a write-scoped `PAGERDUTY_TOKEN`.
- Address the other three open incidents: #5296 (HA entities, likely root cause
  of #5275), #5274 (SSD wear).

### Caveats

- The fix is the same template used by **all** PagerDuty-routed alerts, not just
  Velero — every paged alert's description format changes (now `summary
(namespace): message`). This is the intended improvement but worth eyeballing
  one of each severity after deploy.
- A namespace with N large PVCs still produces one incident with N lines (no
  longer identical). If that's still too noisy, narrow `group_by` or move detail
  into PagerDuty `details`/custom_details (the commented-out block at
  prometheus.ts:200).
- The local `PAGERDUTY_TOKEN` used for triage was pasted into chat — rotate it.
