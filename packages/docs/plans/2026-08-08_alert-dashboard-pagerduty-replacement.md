---
id: plan-2026-08-08-alert-dashboard-pagerduty-replacement
type: plan
status: in-progress
board: false
---

# Alert Dashboard and PagerDuty Replacement

## Goal

Replace PagerDuty's active alert dashboard, durable incident history, API, and
opening-email behavior with a tailnet-only first-party service. Alertmanager
remains authoritative for routing, grouping, inhibition, silences, and current
alert state.

## Decisions

- Build `@shepherdjerred/alert-dashboard` as a Bun/Hono service with a
  Vite/React UI, tRPC, a versioned read-only REST API, Prisma, and PostgreSQL.
- Persist individual Alertmanager occurrences and lifecycle events. Poll all
  Alertmanager active state every 15 seconds; use its webhook for exact routed
  notification events and opening-email eligibility.
- Send one grouped Postal message for newly notified, unsuppressed
  warning/critical occurrences. Do not send resolution mail.
- Keep the UI read-only. There is no on-call, acknowledgement, assignment,
  manual resolution, or silence workflow.
- Use explicit Temporal polyfill imports throughout authored code. Persist
  epoch nanoseconds and expose branded RFC 3339 strings; do not use `Date` or a
  date library.
- Keep normalized history indefinitely and raw webhook bodies for 90 days.
- Treat a changed `startsAt` for the same Alertmanager fingerprint as a refresh
  while an occurrence is open, preserving its original start. After that
  occurrence resolves, a later start creates a new lifecycle occurrence.
- Query Prometheus, Loki, and Tempo through a dedicated read-only Grafana
  service account. Derive bounded previews from validated occurrence metadata;
  never expose an arbitrary query proxy.
- Deploy privately at `alerts.tailnet-1a49.ts.net` with a backed-up PostgreSQL
  cluster and an independent Alertmanager-to-Postal fallback for failures of
  the dashboard itself.
- Split the bootstrap release at the image boundary: the foundation merge
  builds the first image but leaves the Argo CD Application, service-health
  rules, Alertmanager cutover, and active Temporal/TRMNL consumer migration
  unregistered. Activate them only after GHCR is public and a real digest is
  pinned, preserving PagerDuty routing and consumers until the replacement
  passes its email-disabled bootstrap checks. `toolkit alerts` may ship beside
  the retained `toolkit pd` command because it does not alter a live workload.
- Cut over without a long shadow period. Keep the PagerDuty account and Tofu
  state read-only for 30 days, then perform destruction only as a separately
  authorized operation.

## Implementation

1. Add the layered application package, strict compiler/lint/dependency-cruiser
   gates, Prisma schema, lifecycle engine, synchronization adapters, APIs,
   Postal outbox, observability, and tests.
2. Add the functional dashboard, history, detail, preview, and system-health
   routes with URL-backed filters and native browser navigation behavior.
3. Add the application image, Buildkite integration, CDK8s chart, Helm chart,
   deferred ArgoCD application definition, PostgreSQL cluster, network policy,
   monitoring, and secret references. Do not register runtime activation while
   the image pin is the bootstrap placeholder.
4. After bootstrap verification, replace Alertmanager's PagerDuty receiver,
   migrate Temporal/TRMNL consumers, remove the retained toolkit PagerDuty
   command and active PagerDuty credentials, and update current operator
   documentation while preserving historical incident references.
5. Verify synthetic firing, duplicate delivery, resolution, reconciliation,
   opening email, history queries, previews, and absence of active PagerDuty
   traffic in production.

## Acceptance boundaries

Repository tests and synthesized GitOps resources do not prove a live cutover.
Production acceptance requires deploying the service, executing the synthetic
fire/resolve/email scenarios, comparing active state with Alertmanager, and
confirming PagerDuty receives no new events.
