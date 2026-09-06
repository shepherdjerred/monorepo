---
title: Temporal report emails
description: The scheduled-report inventory, human email contract, subject vocabulary, and retained delivery metadata.
sidebar:
  order: 4
---

Temporal sends twelve source-defined scheduled reports plus report-only agent
task results. The schedule definitions remain authoritative for timing; this
page records the email surface they share.

Sources:
[`schedule-definitions-early.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions-early.ts),
[`schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions.ts),
[`security-schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/security-schedule-definitions.ts),
[`report.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/reports/report.ts),
[`report-delivery.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/reports/report-delivery.ts).

## Human email contract

Every HTML and plain-text report presents the same information in this order:

1. The human outcome and a one-sentence summary.
2. Either the requested action or an explicit **No action is needed** message.
3. Important findings, ordered critical, warning, then informational.
4. Optional synthesis and known limitations.
5. **What was checked**, with the labels **Passed**, **Problem**, and
   **Not checked**.
6. A quiet footer with completion time, source or observation window,
   repository revision, and a link to the Temporal execution when available.

The status vocabulary is intentionally small:

| Email label      | Meaning                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| No action needed | The run is complete and has no operator action                              |
| Review needed    | The run is complete, but it found or created something to act on            |
| Check incomplete | Collection, validation, publication, or delivery preparation did not finish |

The HTML uses inline styles, a 640-pixel maximum content width, and a
single-column layout that shrinks to the viewport. It contains no JavaScript or
collapsible content. User-controlled text is escaped, and only validated HTTP
or HTTPS links are rendered.

## Scheduled inventory

All times are `America/Los_Angeles`.

| Schedule                           | Timing              | Clear or current subject           | Changed or action subject                  |
| ---------------------------------- | ------------------- | ---------------------------------- | ------------------------------------------ |
| `homelab-audit-daily`              | daily 06:30         | Your homelab looks healthy         | Action needed: homelab issues found        |
| `deps-summary-weekly`              | Monday 09:00        | Dependencies are up to date        | Dependency changes found                   |
| `scout-data-dragon-version-check`  | Sunday–Friday 06:00 | Scout data is up to date           | Scout Data Dragon update created           |
| `scout-data-dragon-weekly-refresh` | Saturday 06:00      | Scout data is up to date           | Scout Data Dragon update created           |
| `scout-lane-priors-weekly-refresh` | Saturday 07:00      | Scout lane data is up to date      | Scout lane-data update created             |
| `scout-queue-windows-daily`        | daily 06:45         | Scout queue windows are up to date | Action needed: Scout queue-window warnings |
| `scout-season-refresh-weekly`      | Monday 07:00        | Scout season dates are up to date  | Scout season-date update created           |
| `tasknotes-skipped-files-canary`   | daily 09:00         | TaskNotes looks healthy            | Action needed: TaskNotes problem found     |
| `protobufjs-v8-watch-weekly`       | Monday 09:00        | Temporal still uses protobufjs v7  | Temporal can move to protobufjs v8         |
| `main-vuln-scan-weekly`            | Sunday 05:00        | No high-risk vulnerabilities found | Action needed: vulnerabilities found       |
| `link-rot-scan-weekly`             | Sunday 09:00        | No broken links found              | Broken or unreachable links found          |
| `ci-io-post-merge-impact`          | daily 09:00         | CI I/O report is ready             | Action needed: CI I/O target missed        |

Every scheduled family also has explicit copy for pending, partial, and failed
runs. Scout reports distinguish current data, an update created, a manual action,
and a collection or publication failure. CI I/O distinguishes ready, pending,
target missed, and collection failure.

Dynamic report-only agent tasks use the task title itself: `<title>: report
ready`, `Action needed: <title>`, or `<title> could not finish`.

## Retained technical state

Human emails do not expose report-run IDs, workflow IDs, run IDs, raw commands,
required/optional markers, or evidence-receipt IDs. Evidence URLs remain
attached to the relevant finding or check as **View source**.

Those identifiers are not discarded. The validated `ReportEnvelopeV1`, send
lease, archived state, Postal receipt, retries, and Temporal history keep their
existing schemas and behavior. The presentation layer is a pure projection
between the persisted envelope and both renderers, so it does not alter Workflow
inputs or replay history.

## Deterministic preview artifact

`bun run preview:report-emails` writes an untracked gallery to
`/tmp/temporal-report-email-previews/index.html`. The gallery covers every
report family and representative clear, changed, attention, pending, partial,
and failed states without connecting to Temporal, Postal, or an LLM.

## Related

- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Temporal workflow inventory](/reference/temporal-workflows/)
- [Agent task input](/reference/agent-task-input/)
- [How to run the production canary](/how-to/run-the-agent-task-canary/)
