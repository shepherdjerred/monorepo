---
title: Temporal report emails
description: The scheduled-report inventory, semantic @sjer.red routing, Hub Editorial email contract, subject vocabulary, and retained delivery metadata.
sidebar:
  order: 4
---

Temporal sends ten source-defined scheduled reports plus report-only agent
task results. The schedule definitions remain authoritative for timing; this
page records the email routing and layout surface they share.

Sources:
[`schedule-definitions-early.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions-early.ts),
[`schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions.ts),
[`security-schedule-definitions.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/security-schedule-definitions.ts),
[`report.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/shared/reports/report.ts),
[`report-delivery.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/reports/report-delivery.ts).

## Semantic `@sjer.red` routing

Report delivery resolves its sender and recipient per `reportType` through
`@shepherdjerred/ops-model/email/mailbox.ts` and `resolvePostalAddressesForReport`:

| Report families                                                                         | From (`Display Name <address>`)       | To                 |
| --------------------------------------------------------------------------------------- | ------------------------------------- | ------------------ |
| `dependency-summary`                                                                    | `Repo Dependencies <deps@sjer.red>`   | `deps@sjer.red`    |
| `homelab-audit`, `tasknotes-canary`                                                     | `Homelab Audit <ops@sjer.red>`        | `ops@sjer.red`     |
| `scout-data-dragon`, `scout-lane-priors`, `scout-queue-windows`, `scout-season-refresh` | `Scout Automation <scout@sjer.red>`   | `scout@sjer.red`   |
| `main-vuln-scan`, `link-rot-scan`, `agent-task`, and unmapped report types              | `Temporal Reports <reports@sjer.red>` | `reports@sjer.red` |

`temporal-email-recipient` (default `dependencies@sjer.red`) and
`temporal-email-sender` (default `deps@sjer.red`) remain evaluated per delivery
activity. When either flag is set to a non-default address or display-name
mailbox, that explicit override wins for the corresponding header; otherwise the
semantic report-family mailbox is used.

## Human email contract (`Hub Editorial`)

Every HTML and plain-text report projects `ReportEnvelopeV1` into the shared
`EmailDocument` (`Hub Editorial`) layout in this order:

1. Family eyebrow (`Homelab Check`, `Repo Dependencies`, `Scout Automation`,
   `Security Scan`, `Link Check`, `TaskNotes Check`, or `Temporal Report`) and
   top status pill.
2. Plain-English outcome heading and one-sentence summary (`lead`). Clear runs
   do not repeat a second "No action is needed" callout box.
3. Operator guidance when needed: a single `Next step:` line for one action, or
   a `Next steps` callout list when multiple actions apply, followed by a
   primary **View workflow run** button (or **View source** when no Temporal URL
   is present).
4. **Findings** cards when present, ordered `Critical`, `Warning`, then `Note`,
   with optional section kickers and **View source** links.
5. Optional **Notes** (synthesis) and **Not covered** (limitations) prose
   sections.
6. **Checks**, surfacing **Problem** and **Not checked** cards with **View
   source** links while collapsing passing checks into a single
   `✓ N checks passed` summary.
7. A quiet **Technical details** footer with `Completed`, `Source`, `Window`,
   `Commit` (12-character SHA), and `Workflow` (**View workflow run** link).

The status vocabulary is intentionally small:

| Email label      | Meaning                                                                     |
| ---------------- | --------------------------------------------------------------------------- |
| No action needed | The run is complete and has no operator action                              |
| Review needed    | The run is complete, but it found or created something to act on            |
| Check incomplete | Collection, validation, publication, or delivery preparation did not finish |

The HTML uses inline styles plus adaptive `light dark` color-scheme rules from
the `Hub Editorial` palette, a 620-pixel maximum content width, and a
single-column layout that shrinks cleanly to mobile viewports. It contains no
JavaScript or collapsible content. User-controlled text is escaped, and only
validated HTTP or HTTPS links are rendered.

## Scheduled inventory

All times are `America/Los_Angeles`. Every subject follows crisp `<Topic>:
<plain outcome>` grammar without camelCase identifiers or internal slugs.

| Schedule                           | Timing              | Mailbox            | Clear or current subject            | Changed or action subject                  |
| ---------------------------------- | ------------------- | ------------------ | ----------------------------------- | ------------------------------------------ |
| `homelab-audit-daily`              | daily 06:30         | `ops@sjer.red`     | Homelab check: All clear            | Homelab check: Issues need review          |
| `deps-summary-weekly`              | Monday 09:00        | `deps@sjer.red`    | Dependencies: Up to date            | Dependencies: Updates available            |
| `scout-data-dragon-version-check`  | Sunday–Friday 06:00 | `scout@sjer.red`   | Scout update: Patch data up to date | Scout update: Data Dragon PR opened        |
| `scout-data-dragon-weekly-refresh` | Saturday 06:00      | `scout@sjer.red`   | Scout update: Patch data up to date | Scout update: Data Dragon PR opened        |
| `scout-lane-priors-weekly-refresh` | Saturday 07:00      | `scout@sjer.red`   | Scout lane data: Up to date         | Scout lane data: Update PR opened          |
| `scout-queue-windows-daily`        | daily 06:45         | `scout@sjer.red`   | Scout queues: Windows up to date    | Scout queues: Warnings need review         |
| `scout-season-refresh-weekly`      | Monday 07:00        | `scout@sjer.red`   | Scout season: Dates up to date      | Scout season: Update PR opened             |
| `tasknotes-skipped-files-canary`   | Monday 09:00        | `ops@sjer.red`     | TaskNotes check: All clear          | TaskNotes check: Issue needs review        |
| `main-vuln-scan-weekly`            | Sunday 05:00        | `reports@sjer.red` | Security scan: No high-risk issues  | Security scan: Vulnerabilities need review |
| `link-rot-scan-weekly`             | Sunday 09:00        | `reports@sjer.red` | Link check: All links reachable     | Link check: Broken links found             |

Every scheduled family also has explicit `<Topic>: <plain outcome>` copy for
pending, partial, and failed runs. Scout reports distinguish current data, an
opened update PR, an item needing review, and a collection or publication
failure.

Dynamic report-only agent tasks route to `reports@sjer.red` and use the task
title as the topic: `<title>: Report ready`, `<title>: Action needed`, or
`<title>: Could not finish`.

## Retained technical state

Human emails do not expose report-run IDs, workflow IDs, run IDs, raw commands,
required/optional markers, or evidence-receipt IDs. Evidence URLs remain
attached to the relevant finding or attention check as **View source**.

Those identifiers are not discarded. The validated `ReportEnvelopeV1`, send
lease, archived state, Postal receipt, retries, and Temporal history keep their
existing schemas and behavior. The presentation layer is a pure projection
between the persisted envelope and both renderers, so it does not alter Workflow
inputs or replay history.

## Deterministic preview artifact

`bun run preview:report-emails` writes an untracked gallery to
`/tmp/temporal-report-email-previews/index.html`. The gallery covers every
report family, its semantic `@sjer.red` sender and recipient, and representative
clear, changed, attention, partial, and failed states without connecting to
Temporal, Postal, or an LLM.

## Related

- [Temporal schedule mechanics](/reference/temporal-schedules/)
- [Temporal workflow inventory](/reference/temporal-workflows/)
- [Agent task input](/reference/agent-task-input/)
- [How to run the production canary](/how-to/run-the-agent-task-canary/)
