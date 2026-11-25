---
title: Temporal report emails
description: The scheduled-report inventory, semantic @sjer.red routing, notification and remediation policies, Hub deep links, and Hub Editorial email contract.
sidebar:
  order: 4
---

Temporal sends eleven source-defined scheduled reports plus report-only agent task results.
Schedule definitions own timing, while shared report contracts govern routing, quiet suppression, remediation, and Hub archival.

Sources:
[`schedule-definitions-early.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions-early.ts),
[`schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions.ts),
[`security-schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/security-schedule-definitions.ts),
[`minecraft-schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/minecraft-schedule-definitions.ts),
[`report.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/reports/report.ts),
[`report-delivery.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/reports/report-delivery.ts),
[`mailbox.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/ops-model/src/email/mailbox.ts),
and `packages/ops-model/src/reports/schedule-catalog.ts`.

## Semantic `@sjer.red` routing

Report delivery resolves its sender and recipient per `reportType` through [`mailbox.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/ops-model/src/email/mailbox.ts) and `resolvePostalAddressesForReport`:

| Report families                                                                           | From (`Display Name <address>`)       | To                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------- | ------------------ |
| `dependency-summary`                                                                      | `Repo Dependencies <deps@sjer.red>`   | `deps@sjer.red`    |
| `homelab-audit`, `tasknotes-canary`                                                       | `Homelab Audit <ops@sjer.red>`        | `ops@sjer.red`     |
| `scout-data-dragon`, `scout-lane-priors`, `scout-queue-windows`, `scout-season-refresh`   | `Scout Automation <scout@sjer.red>`   | `scout@sjer.red`   |
| `main-vuln-scan`, `link-rot-scan`, `storm-promotion`, `agent-task`, and unmapped families | `Temporal Reports <reports@sjer.red>` | `reports@sjer.red` |

`temporal-email-recipient` (default `dependencies@sjer.red`) and `temporal-email-sender` (default `deps@sjer.red`) evaluate per delivery activity.
A non-default address or display-name mailbox overrides the corresponding header; default values keep semantic family routing.

## Scheduled inventory

All times are `America/Los_Angeles`.
Subjects use `<Topic>: <plain outcome>` grammar without camelCase identifiers or internal slugs.

| Schedule                           | Cadence & policy                | Mailbox            | Automation       | Subjects (clear / changed or action)                                                |
| ---------------------------------- | ------------------------------- | ------------------ | ---------------- | ----------------------------------------------------------------------------------- |
| `homelab-audit-daily`              | daily 06:30 (`daily-changed`)   | `ops@sjer.red`     | Diagnostic       | Homelab check: All clear · Homelab check: Issues need review                        |
| `scout-queue-windows-daily`        | daily 06:45 (`daily-changed`)   | `scout@sjer.red`   | LLM review PR    | Scout queues: Windows up to date · Scout queues: Warnings need review               |
| `the-storm-promotion-daily`        | daily 08:00 (`daily-changed`)   | `reports@sjer.red` | Diagnostic       | The Storm promotion summary: All clear · The Storm promotion summary: Action needed |
| `scout-data-dragon-version-check`  | Sun–Fri 06:00 (`daily-changed`) | `scout@sjer.red`   | Deterministic PR | Scout update: Patch data up to date · Scout update: Data Dragon PR opened           |
| `scout-data-dragon-weekly-refresh` | Saturday 06:00 (`cadence`)      | `scout@sjer.red`   | Deterministic PR | Scout update: Patch data up to date · Scout update: Data Dragon PR opened           |
| `scout-lane-priors-weekly-refresh` | Saturday 07:00 (`cadence`)      | `scout@sjer.red`   | Deterministic PR | Scout lane data: Up to date · Scout lane data: Update PR opened                     |
| `main-vuln-scan-weekly`            | Sunday 05:00 (`cadence`)        | `reports@sjer.red` | LLM review PR    | Security scan: No high-risk issues · Security scan: Vulnerabilities need review     |
| `link-rot-scan-weekly`             | Sunday 09:00 (`cadence`)        | `reports@sjer.red` | Auto-merge PR    | Link check: All links reachable · Link check: Broken links found                    |
| `scout-season-refresh-weekly`      | Monday 07:00 (`cadence`)        | `scout@sjer.red`   | LLM review PR    | Scout season: Dates up to date · Scout season: Update PR opened                     |
| `deps-summary-weekly`              | Monday 09:00 (`cadence`)        | `deps@sjer.red`    | LLM review PR    | Dependencies: Up to date · Dependencies: Updates available                          |
| `tasknotes-skipped-files-canary`   | Monday 09:00 (`cadence`)        | `ops@sjer.red`     | Diagnostic       | TaskNotes check: All clear · TaskNotes check: Issue needs review                    |

[`promotion/report.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/promotion/report.ts) builds the `storm-promotion` envelope for `the-storm-promotion-daily`.
Dynamic report-only agent tasks route to `reports@sjer.red` as `<title>: Report ready`, `<title>: Action needed`, or `<title>: Could not finish`.

## Notification policy

Quiet-clear suppression keeps routine clear heartbeats in Hub while sending mail on baselines, active changes, recoveries, and seven-day reminders.
Sources:
[`report-notification-policy.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/reports/report-notification-policy.ts),
[`report-notifications.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/config/report-notifications.ts),
[`digest-flag.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/alert-dashboard/src/infrastructure/digest-flag.ts),
[`ops-digest-service.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/alert-dashboard/src/application/ops-digest-service.ts),
[`managed-flag-inventory.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/managed-flag-inventory.json).

| Policy or flag                                | Owner             | Behavior                                                                                                                                                                                      |
| --------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cadence`                                     | Temporal reports  | Sends Postal mail on every scheduled run.                                                                                                                                                     |
| `daily-changed`                               | Temporal + Hub    | Suppresses unchanged clear runs (`deliveryStatus: "skipped"`) and records full run state in Hub.                                                                                              |
| `temporal-daily-report-notifications-enabled` | `temporal`        | Enables `daily-changed` suppression for daily Temporal report schedules (`homelab-audit-daily`, `scout-queue-windows-daily`, `the-storm-promotion-daily`, `scout-data-dragon-version-check`). |
| `alert-dashboard-daily-digest-quiet-clear`    | `alert-dashboard` | Skips Postal delivery (`skipReason: "unchanged-clear"`) when a daily Ops digest and its prior daily digest are both clear.                                                                    |

## Automated remediation

Remediation-capable workflows attach `ReportEnvelopeV1.remediation` metadata (`outcome`, `prUrl`, `branchName`, `commitSha`, `autoMergeEnabled`, `changedFiles`) before delivery.
Source: [`managed-flag-inventory.json`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/managed-flag-inventory.json) and `packages/ops-model/src/reports/report-envelope.ts`.

| Flag or schedule                                                                                           | Mode             | PR behavior                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `temporal-report-auto-remediation-enabled`                                                                 | Flags gate       | Enables automated branch and pull request creation for LLM-remediated report workflows. |
| `link-rot-scan-weekly`                                                                                     | Auto-merge PR    | Opens a pull request for verified link updates with `autoMergeEnabled: true`.           |
| `main-vuln-scan-weekly`, `deps-summary-weekly`, `scout-queue-windows-daily`, `scout-season-refresh-weekly` | LLM review PR    | Opens a pull request with `autoMergeEnabled: false` for human review before merge.      |
| `scout-data-dragon-version-check`, `scout-data-dragon-weekly-refresh`, `scout-lane-priors-weekly-refresh`  | Deterministic PR | Opens deterministic data-refresh pull requests without LLM code synthesis.              |

## Hub ingestion and deep links

Hub persists every report run and archived digest so concise emails link directly to full evidence.
Sources: [`tool-links.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/ops-model/src/tool-links.ts), [`ops-digest-email.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/alert-dashboard/src/domain/ops-digest-email.ts), [`app.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/alert-dashboard/src/server/app.ts), and `packages/alert-dashboard/src/server/report-routes.ts`.

| Surface                          | Path or label                       | Contract                                                                                                          |
| -------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Ingest endpoint                  | `POST /internal/v1/reports/runs`    | Accepts `ReportRunIngestBatch` (`OPS_INGEST_TOKEN`), upserts `ReportRun` rows, and publishes SSE `"reports"`.     |
| Hub overview                     | `/reports`                          | Lists 13 recurring report and digest streams, 30-day Pacific strips, KPIs, and the unified outbound mail feed.    |
| Report deep link (`Open in Hub`) | `/reports/runs/:id`                 | Renders remediation metadata, state-filtered findings, all checks, raw evidence commands/excerpts, and HTML mail. |
| Digest deep link (`Open in Hub`) | `/reports/digests/:kind/:periodKey` | Renders archived or live-preview `DigestReport` panels alongside the exact HTML and plain-text digest email.      |
| Incident mail inspector          | `/reports/mail/:id`                 | Renders `EmailOutbox` delivery state, linked `/alerts/:id` occurrences, and the stored incident email.            |

## Human email contract (`Hub Editorial`)

Every HTML and plain-text report projects `ReportEnvelopeV1` into the shared `EmailDocument` (`Hub Editorial`) layout in this order:

1. Family eyebrow (`Homelab Check`, `Repo Dependencies`, `Scout Automation`, `Security Scan`, `Link Check`, `TaskNotes Check`, `The Storm Promotion`, or `Temporal Report`) in muted text, with the run status at the right as a small coloured dot plus the status word (no pill badges).
2. Plain-English outcome heading and one-sentence summary (`lead`) without repeating a clear-run callout box.
3. Operator guidance (`Next step:` or `Next steps`), followed by **Review pull request** or **Open in Hub** as the primary action and secondary links for Hub or Temporal.
4. Optional **Automated remediation** item and hairline-separated **Findings** list ordered `Critical`, `Warning`, then `Note` (with group headings when severities mix, coloured dots, optional kickers, and **View source** links).
5. Optional **Notes** (synthesis) and **Not covered** (limitations) prose sections.
6. **Checks**, surfacing **Problem** and **Not checked** rows while collapsing passing checks into `✓ N checks passed`.
7. A **Technical details** footer with `Completed`, `Source`, `Window`, `Commit` (12-character SHA), and `Workflow`.

| Email label      | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| No action needed | The run is complete and has no operator action                               |
| Review needed    | The run is complete, and it found or opened something requiring human review |
| Check incomplete | Collection, validation, publication, or delivery preparation did not finish  |

The HTML uses inline styles plus adaptive `light dark` color-scheme rules.
[`themes.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/ops-model/src/email/themes.ts) holds literal copies of the shared console tokens (`packages/console-ui`), guarded by a drift test: tan canvas, white panel with hairline border and 10-pixel radius, 620-pixel maximum width, system sans text, mono figures, and a primary button with a static darker bottom edge.
It contains no JavaScript or collapsible content; user-controlled text is escaped, and only validated HTTP or HTTPS links render.

## Retained technical state

Human emails omit report-run IDs, run IDs, raw collector commands, SHA-256 digests, required/optional check flags, and recovered or suppressed findings.
The persisted `ReportEnvelopeV1` in Hub (`/reports/runs/:id`) and object storage retains every field without altering Workflow replay history.

## Deterministic preview artifact

`bun run preview:report-emails` writes an untracked gallery to `/tmp/temporal-report-email-previews/index.html`.
The gallery covers every report family, its semantic `@sjer.red` mailbox, and clear, changed, attention, partial, and failed states offline.

## Related

- [Alerts and incident history](/explanation/homelab/alerts/)
- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Temporal workflow inventory](/reference/temporal-workflows/)
- [Agent task input](/reference/agent-task-input/)
- [How to run the production canary](/how-to/run-the-agent-task-canary/)
