# Migrate off PagerDuty → Alertmanager-native email (Postal) + Grafana as viewer

## Status

In Progress (planning)

## Context

PagerDuty is the **only external SaaS receiver** in the homelab. In practice it's used for exactly two things: **collect Prometheus/Loki alerts** and **email them to me**. The on-call, escalation, scheduling, status-page, and mobile-app features are all unused (team of one). PagerDuty is effectively an expensive SMTP relay plus a read-only "current alerts" API that some automation polls.

**Goal:** remove PagerDuty entirely. Keep **Alertmanager as the single source of truth** (alert rules stay as Prometheus `PrometheusRule` CRDs — **no Grafana-managed alerts**). Deliver notifications as **email via self-hosted Postal**. Use the **Grafana Alerting UI as a read-only viewer** of the external Alertmanager. No paging, no app, no new SaaS.

Decisions locked with the user: Postal for SMTP; Grafana as viewer only; Alertmanager stays SOT.

## What changes (summary)

| Area                                | Today                                                | After                                                      |
| ----------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| Notification delivery               | Alertmanager `pagerduty_configs` → PagerDuty → email | Alertmanager `email_configs` → Postal SMTP → inbox         |
| Alert source of truth               | Prometheus `PrometheusRule` CRDs (unchanged)         | **unchanged**                                              |
| Dashboard                           | PagerDuty web UI                                     | Grafana Alerting UI (read-only) + existing Alertmanager UI |
| "Current alerts" API for automation | PagerDuty `/incidents`                               | Alertmanager `/api/v2/alerts`                              |
| Secret                              | `PAGERDUTY_TOKEN` in `alertmanager-secrets` 1P item  | `POSTAL_SMTP_PASSWORD` in same item                        |
| SaaS dependency                     | PagerDuty                                            | **none**                                                   |
| New services                        | —                                                    | none (Postal already runs)                                 |

---

## Phase 1 — Core swap (gets us off PagerDuty for the only thing it's used for)

### 1a. Postal one-time setup (operator, via Postal web UI at `postal.tailnet-1a49.ts.net`)

- Confirm/create a **mail server** + a **sending domain** (e.g. `sjer.red` or a dedicated `alerts.sjer.red`) and a **SMTP credential** (type: SMTP).
- Store the SMTP password as field **`POSTAL_SMTP_PASSWORD`** on the existing 1Password item backing `alertmanager-secrets` (`cki3qk5okk5b7xn3jmlpg74yka`). Note the SMTP username.
- Pin a stable **`metadata.name`** on the Postal SMTP `Service` in `packages/homelab/src/cdk8s/src/resources/mail/postal.ts:431` (e.g. `postal-smtp`) so Alertmanager can address it by a fixed DNS name (cdk8s-plus otherwise hash-suffixes the name). Resulting smarthost: `postal-smtp.postal.svc.cluster.local:25`.

### 1b. Alertmanager: replace the `pagerduty` receiver with an `email` receiver

File: `packages/homelab/src/cdk8s/src/resources/argo-applications/prometheus.ts`

- **`global`** (line 150): add SMTP settings —
  - `smtp_smarthost: "postal-smtp.postal.svc.cluster.local:25"`
  - `smtp_from: "alerts@sjer.red"` (a domain Postal is configured to send)
  - `smtp_auth_username: "<postal smtp credential username>"`
  - `smtp_auth_password_file: "/etc/alertmanager/secrets/${alertmanagerSecrets.name}/POSTAL_SMTP_PASSWORD"`
  - `smtp_require_tls: true` (STARTTLS). If Postal's internal SMTP cert fails verification, fall back to `false` (in-cluster traffic) — note in the commit.
- **`receivers`** (lines 179–234): delete the `pagerduty` receiver; add an `email` receiver with `email_configs`:
  - `to: "claude@sjer.red"`, `send_resolved: true`
  - `headers: { Subject: <go template> }` and a `html`/`text` body that mirror the current PagerDuty `description` template logic (per-alert `summary` + `(namespace)` + `message` → fallback `description`). Reuse `escapeHelmGoTemplate(...)` (already imported, line 20) since kube-prometheus-stack passes values through Helm templating first.
- **`route`** (lines 235, 273): change `receiver: "pagerduty"` → `receiver: "email"` in both the default route and the `severity =~ "critical|warning"` route. Leave the `null` routes (Watchdog/InfoInhibitor/info/NodeMemoryMajorPagesFaults/PDB) untouched.
- Keep `secrets: [alertmanagerSecrets.name]` (line 146) — same mount, new key.

### 1c. Grafana: viewer only, no managed alerts

File: `packages/homelab/src/cdk8s/src/resources/argo-applications/grafana-values.ts:127-131`

- Set `sidecar.datasources.alertmanager.handleGrafanaManagedAlerts: false`. Keeps the auto-provisioned Alertmanager datasource (so the Grafana **Alerting → Alert groups/Silences** UI shows the external Alertmanager) but stops Grafana from pushing any Grafana-managed alerts to it. No Grafana alert rules are created.

### 1d. Update the regression test

File: `packages/homelab/src/cdk8s/src/helm-template.test.ts:172` — the existing assertion validates the PagerDuty template escaping. Repoint it to assert the new `email_configs` subject/body template renders correctly (real newlines, namespace present, `message`→`description` fallback).

---

## Phase 2 — Re-point the "current alerts" consumers to Alertmanager's API

Source of truth becomes `GET {ALERTMANAGER_URL}/api/v2/alerts?active=true`. In-cluster: `http://prometheus-kube-prometheus-alertmanager.prometheus:9093`. From a laptop: `https://alertmanager.tailnet-1a49.ts.net` (tailnet-gated). Each alert carries a stable `fingerprint`, `labels`, `annotations`, `status`, `startsAt`.

### 2a. toolkit — replace the `pd` command tree with `alerts`

Files: `packages/toolkit/src/lib/pagerduty/*` (`client.ts`, `schemas.ts`, `types.ts`, `incidents.ts`, `format.ts`), `src/handlers/pagerduty.ts`, `src/commands/pagerduty/incidents.ts`, registration in `src/index.ts`, plus `packages/toolkit/AGENTS.md`.

- New `src/lib/alertmanager/` client following the same pattern (Zod-validated `fetch`, `Bun.env["ALERTMANAGER_URL"]`). Commands: `toolkit alerts list` (active alerts), `toolkit alerts show <fingerprint>`. Markdown default, `--json` flag — mirror the existing PD command ergonomics.
- Remove the PagerDuty handler/lib/commands and the `pd`/`pagerduty` registration.

### 2b. Temporal alert-remediation + homelab-audit

Files: `packages/temporal/src/activities/alert-remediation-collect.ts`, `alert-remediation.ts`, `src/shared/alert-remediation.ts` (the `AlertRemediationSourceSchema` enum: `"pagerduty"` → `"alertmanager"`), `src/workflows/alert-remediation.ts`, `src/activities/homelab-audit-prompts.ts` (`"Open PagerDuty incidents"` → `"Active Alertmanager alerts"`), `src/activities/homelab-audit.ts:161`, and the worker env injection at `packages/homelab/src/cdk8s/src/resources/temporal/worker.ts:66` (`PAGERDUTY_TOKEN` → `ALERTMANAGER_URL`). Fingerprint key `pagerduty:<id>` → `alertmanager:<fingerprint>`. Update the matching tests (`*alert-remediation*.test.ts`, `homelab-audit-prompts.test.ts`). Keep Bugsink collection untouched (separate source).

### 2c. TRMNL dashboard tile

Files: `packages/trmnl-dashboard/src/clients/pagerduty.ts`, `config.ts`, `types.ts`, and homelab env injection `packages/homelab/src/cdk8s/src/resources/trmnl-dashboard/index.ts:119-121`.

- Replace `PagerDutyClient` with an Alertmanager client; the tile shows **active-alert count** (drop the on-call name — meaningless solo). Swap `PAGERDUTY_TOKEN` → `ALERTMANAGER_URL`.

---

## Phase 3 — Cleanup / fast-follow

- **Sentinel POC** (`poc/sentinel/...`): add an Alertmanager `webhook_configs` receiver pointing at a new `/webhook/alertmanager` endpoint and parse the Alertmanager payload instead of the PagerDuty one; or retire the PD webhook. Lowest priority (POC).
- **Skill**: update `packages/dotfiles/dot_agents/skills/pagerduty-helper/SKILL.md` → an `alertmanager-helper` (or fold into `grafana-helper`); per the chezmoi dual-edit rule, also update the live copy under `~/.claude/skills/`.
- **1Password**: once Phase 1 is verified, remove the now-unused `PAGERDUTY_TOKEN` field.
- **Comment/doc text**: monitoring rule comments mentioning PagerDuty (`monitoring/rules/temporal.ts`, `tasknotes.ts`, `pr-review-bot.ts`), `talos/README.md:33`, and the PD logs/todos in `packages/docs/` — reword to "alert/email". Close `packages/docs/todos/pagerduty-velero-alert-formatting.md` (the template it tracks is being replaced).

## Out of scope / explicit caveat

- **Dead-man's-switch:** Alertmanager runs _in_ the cluster, so neither it nor Postal can email you if the whole cluster is down — same blind spot PagerDuty had unless its Watchdog was externally wired. If wanted later, route the `Watchdog` alert to an external heartbeat (healthchecks.io / ntfy) instead of `null`. Not part of this migration.
- **Simpler fallback for 1b** if Postal SMTP auth/TLS proves fiddly: point `smtp_smarthost` straight at `smtp.fastmail.com:587` reusing the existing Fastmail 1P creds (`y2xpkfyirxjlcq7oluqxoyxxce`). Postal relays through Fastmail anyway, so deliverability is equivalent. Kept as a fallback only since the user chose Postal.

## Verification

1. **Render & types:** `cd packages/homelab && bun run typecheck && bun test` (helm-template.test.ts must pass with the new email template). `bunx eslint . --fix`.
2. **Local Alertmanager render:** synth the prometheus chart and confirm the rendered Alertmanager config shows the `email` receiver, the `global.smtp_*` block, and both routes pointing at `email`.
3. **End-to-end email:** after ArgoCD syncs, fire a test alert (e.g. `amtool alert add` against the in-cluster Alertmanager, or temporarily relax a rule) and confirm the email lands in `claude@sjer.red`. Verify `send_resolved` produces a resolved email. Check `postal-worker` logs + Postal UI message log for delivery.
4. **Grafana viewer:** open Grafana → Alerting → Alert groups; confirm active Alertmanager alerts render and that no Grafana-managed alert rules exist.
5. **Automation:** `ALERTMANAGER_URL=https://alertmanager.tailnet-1a49.ts.net toolkit alerts list` returns active alerts; run the Temporal alert-remediation activity locally and confirm it reads Alertmanager alerts (fingerprints) instead of PD incidents.
6. **PR artifact:** screenshot the alert email (firing + resolved) and the Grafana Alerting view.
