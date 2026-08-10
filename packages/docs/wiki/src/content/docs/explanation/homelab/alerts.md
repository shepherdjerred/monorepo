---
title: Alerts and incident history
description: Alertmanager remains authoritative for live alert state, while the staged Alerts service adds durable history, a dashboard, bounded Grafana previews, and opening email.
---

Alerts is the planned human-facing ledger for the homelab's Alertmanager data.
It adds history and browsing without becoming an on-call system or taking over
routing, grouping, inhibition, silences, or current-state authority.

## System map

```mermaid
flowchart LR
  accTitle: Alert routing and durable history
  accDescr: Alertmanager remains authoritative. It sends notifications to the current PagerDuty path while the Alerts foundation is staged. After activation, Alertmanager webhooks and snapshots feed a PostgreSQL ledger; the dashboard, read-only API, toolkit, Grafana previews, and Postal opening email use that ledger.

  AM[Alertmanager\nrouting and live state]
  PD[PagerDuty\ncurrent notification path]
  LEDGER[Alerts service\nwebhook and reconciliation]
  DB[(PostgreSQL\nlifecycle ledger)]
  UI[Dashboard and\nread-only APIs]
  CLI[toolkit alerts]
  GRAFANA[Grafana previews\nPrometheus Loki Tempo]
  POSTAL[Postal\nopening email]

  AM --> PD
  AM -. staged webhook and snapshots .-> LEDGER
  LEDGER --> DB
  DB --> UI
  UI --> CLI
  LEDGER --> GRAFANA
  LEDGER --> POSTAL
```

## Current deployment boundary

The application, image, database chart, network policy, observability rules,
and Argo CD application definition exist in the repository. The Argo CD
application and new Alertmanager receiver are intentionally not registered yet,
so PagerDuty remains the active runtime path and `toolkit pd` remains valid.

Activation is a separate operational step: publish and make the image public,
pin its real digest, bootstrap reconciliation with email disabled, then verify a
synthetic fire/resolve before changing Alertmanager. This avoids deploying a
zero-digest image or silently replacing the working notification path.

## Operator workflow after activation

The UI provides active, suppressed, and historical occurrence views. The CLI
uses the same read-only API for focused checks:

```bash
toolkit alerts list --state open
toolkit alerts list --opened-from 2026-08-03T00:00:00Z --json
toolkit alerts list --resolved-from 2026-08-03T00:00:00Z --json
toolkit alerts show <occurrence-id>
```

An occurrence can resolve through a webhook or reconciliation; neither means a
human acknowledged or manually closed it. Alert acknowledgement, assignment,
manual resolution, silence management, paging, and on-call schedules are not
part of this service.

## Where to look

- Service and UI: `packages/alert-dashboard/`.
- Deployment definitions: `packages/homelab/src/cdk8s/src/resources/alert-dashboard/`.
- Operator CLI: `packages/toolkit/src/handlers/alerts.ts`.
- Activation and PagerDuty retirement boundary:
  `packages/docs/todos/pagerduty-migration.md`.
