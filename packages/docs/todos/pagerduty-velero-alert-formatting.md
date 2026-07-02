---
id: pagerduty-velero-alert-formatting
status: waiting-on-verification
origin: packages/docs/logs/2026-05-30_pagerduty-velero-duplicate-alerts.md
source_marker: false
---

# Verify PagerDuty alert description formatting after deploy

## Verification (2026-06-28) — can't confirm yet; no post-fix velero alert has fired

The fix (real-newline template + `.Annotations.message` fallback) is on `main` with a
`helm-template.test.ts` assertion. But a live confirmation needs a velero alert to actually fire,
and the **only** velero PagerDuty incidents are all from **2026-05-30** — i.e. pre-fix — and they
_do_ show the bug (titles literally contain `\n\n`, e.g. `Large PVC may impact Velero backups\n\n`).
No velero alert has fired since the fix, so there's nothing post-fix to inspect. Stays
`waiting-on-verification` until the next real velero incident (or fold into `pagerduty-migration`
if that lands first).

The Alertmanager → PagerDuty `description` template was fixed
([prometheus.ts:192](../../homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts#L192))
to use a real newline and the correct `.Annotations.message` annotation (with
`.description` fallback) plus the namespace. The fix could not be validated
end-to-end locally (`helm` not installed; cdk8s synth hits a Windows path bug;
ESLint flat config not built in the worktree).

## To verify

1. `cd packages/homelab && bun run test` in CI/Linux — the helm-template E2E
   suite must pass, including the new assertions in
   `src/cdk8s/src/helm-template.test.ts` (references `.Annotations.message` and
   `.Labels.namespace`; rejects the literal `{{ .Annotations.summary }}\n`).
2. After the chart deploys, trigger or wait for a real paged alert and confirm
   the PagerDuty incident title shows `<summary> (<namespace>): <detail>` with
   **no** literal `\n`.
3. Spot-check one critical and one warning alert from a different rule family
   (not Velero) — the template change affects every PagerDuty-routed alert.

Resolve (delete this doc) once a real incident confirms the new formatting.
