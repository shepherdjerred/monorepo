---
id: pagerduty-velero-alert-formatting
type: todo
status: complete
board: false
origin: packages/docs/logs/2026-05-30_pagerduty-velero-duplicate-alerts.md
source_marker: false
---

# Verify PagerDuty alert description formatting after deploy

## Evidence

The fix (real-newline template + `.Annotations.message` fallback) is on `main`
with a `helm-template.test.ts` assertion. Post-fix production incidents now
confirm the shared title and Custom Details shapes.

The Alertmanager to PagerDuty `description` template was fixed
([prometheus.ts:192](../../homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts#L192))
to use a real newline and the correct `.Annotations.message` annotation (with
`.description` fallback) plus the namespace. The fix could not be validated
end-to-end locally (`helm` not installed; cdk8s synth hits a Windows path bug;
ESLint flat config not built in the worktree).

## Remaining

- [x] Confirm a real Velero incident has a single-line shared summary with the namespace and no literal `\n`.
- [x] Confirm the per-alert message appears under PagerDuty Custom Details rather than in the title.
- [x] Spot-check one critical and one warning incident from another rule family and record incident IDs and timestamps.

## Comment Log

### 2026-07-27 — Awaiting-human audit

The deterministic Helm assertion is already present. PR #1381 subsequently
made incident titles single-line and moved per-alert bodies into `details`, so
the old expected title shape was refreshed and the delayed observation is now
agent-owned.

### 2026-07-27 — Production verification

- Incident #6828, created `2026-07-27T05:58:12Z`, used the single-line title
  `Large PVC may impact Velero backups [turbo-cache]`. Its warning alert body
  appeared in Custom Details under `firing`, alongside `namespace:
turbo-cache`, `num_firing: 1`, and the alert name.
- Critical incident #6831, created `2026-07-27T18:46:55Z`, used the single-line
  title `Postal MariaDB is down [postal]` and kept its StatefulSet message in
  Custom Details.
- Warning incident #6824, created `2026-07-27T04:25:04Z`, used the single-line
  title `PVC storage usage above 90% [media]` and kept its PVC usage message in
  Custom Details.

These live incidents verify the post-PR #1381 format across Velero and two
other rule families.
