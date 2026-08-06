---
id: plan-2026-07-11-xcode-cloud-alerts
type: plan
status: complete
board: false
---

# Xcode Cloud build-failure alerts → Alertmanager → PagerDuty

## Context

The **tasks-for-obsidian** iOS app is the only thing built on **Xcode Cloud**
(`packages/tasks-for-obsidian/ios/ci_scripts/ci_post_clone.sh`). Build failures were
invisible until TestFlight silently didn't update. We surface them as incidents on the
homelab **PagerDuty dashboard** (PD is a passive dashboard here — it never phones/pages).

Requirement: integrate **through Alertmanager, not PagerDuty directly**, so swapping PD out
later touches only the Alertmanager receiver.

**Design (Option B):** Xcode Cloud webhook → a tiny receiver in the **Temporal worker** →
Alertmanager (`POST /api/v2/alerts`, in-cluster) → the existing `pagerduty` receiver.
Chosen over a CI-script push because a webhook catches every terminal failure (including
clone/dependency failures where `ci_post_xcodebuild.sh` never runs) and keeps Alertmanager
off the public internet. The receiver reuses the worker's existing public-webhook pattern
(Hono + Cloudflare Tunnel + 1Password secret), so no new image / cdk8s chart / ArgoCD app.

No off-the-shelf Xcode Cloud→Alertmanager integration exists (only a Swift/Vapor prior art,
`jagreenwood/xcode-cloud-webhook`); both halves — `POST /api/v2/alerts` and Xcode Cloud
webhooks — are standard.

## Implementation

**Receiver (`packages/temporal/src/event-bridge/`)**

- `xcode-cloud-webhook-schema.ts` — Zod schema tolerant of both payload nestings (Apple's
  flat reference vs the real-world `attributes`-wrapped shape); `normalizeXcodeCloudPayload`
  flattens them; `classifyBuild` returns `firing` (FAILED/ERRORED) / `resolved` (SUCCEEDED) /
  `ignore` (create/start/CANCELED/SKIPPED). Terminal = `metadata.eventType==="BUILD_COMPLETED"`
  or `executionProgress==="COMPLETE"`. Decision fields are never defaulted, so an unexpected
  shape can't manufacture a false alert.
- `xcode-cloud-webhook.ts` — Hono app `POST /hook/:token` (timing-safe token in URL path,
  since Xcode Cloud sends no auth header). Fires a `severity=warning` alert with dedup labels
  `{alertname:"XcodeCloudBuildFailed", service, product, workflow, branch}` (no build number,
  so a later SUCCEEDED resolves it); safety `endsAt = now + XCODE_CLOUD_ALERT_TTL_SECONDS`
  (default 6h). `createAlertmanagerPoster(baseUrl)` does the real `POST`.
- `index.ts` — optional-start in `startHttpServers` (only when `XCODE_CLOUD_WEBHOOK_TOKEN` set).

**Homelab (`packages/homelab/src/cdk8s/src/resources/temporal/`)**

- `http-services.ts` — `createXcodeCloudWebhookService`: Service :9468 + Cloudflare Tunnel
  `xcode-cloud-webhook` → `https://xcode-cloud-webhook.sjer.red`.
- `worker.ts` — port 9468; env `XCODE_CLOUD_WEBHOOK_PORT`, `ALERTMANAGER_URL` (literals),
  `XCODE_CLOUD_WEBHOOK_TOKEN` (secretKeyRef).
- **No `prometheus.ts` change, no PagerDuty change** — `severity=warning` already routes to
  the `pagerduty` receiver.

**Tests (all deterministic, run in CI)**

- `xcode-cloud-webhook.test.ts` — auth (401 incl. same-length), FAILED/ERRORED→firing,
  SUCCEEDED→resolved (matching dedup labels), CANCELED/create→ignore, 400 on bad JSON/shape,
  500 on poster failure, real-`fetch`-capture asserting `POST <base>/api/v2/alerts`, and a
  schema/classification golden over committed fixtures (`__fixtures__/xcode-cloud/`).
- `pagerduty-alerting.test.ts` — added a **route guard**: evaluates the rendered Alertmanager
  route tree the way Alertmanager does and asserts `{alertname:XcodeCloudBuildFailed,
severity:warning}` resolves to `pagerduty` (+ Watchdog/info → null sanity + structural check).

## Manual steps (operator)

1. **1Password** — add field `XCODE_CLOUD_WEBHOOK_TOKEN` to item `temporal-temporal-worker-1p`
   (vault `v64ocnykdqju4ui6j6pua56xw4`), then `cd packages/homelab/src/cdk8s &&
bun run scripts/snapshot-1password-vault.ts` and commit the updated snapshot.
2. **Deploy** — merge; ArgoCD rolls the Temporal worker.
3. **App Store Connect** — the app → Xcode Cloud → Settings → Webhooks → + →
   URL `https://xcode-cloud-webhook.sjer.red/hook/<token>`.

## Verification

CI (gates PR): `packages/temporal` `bun run test`/`typecheck`/lint, `packages/homelab`
`bun run test` (route guard), and `check-1password-items.ts`.

Manual (post-deploy): `curl` the deployed `/hook/<token>` with a committed FAILED fixture →
alert live at `https://alertmanager.tailnet-1a49.ts.net/api/v2/alerts` + incident on PD
dashboard; SUCCEEDED fixture resolves it. Then a real failing iOS build or App Store Connect's
webhook delivery-report re-send confirms end-to-end.

## Historical follow-up state

- Complete and verify the work described in `Xcode Cloud build-failure alerts → Alertmanager → PagerDuty`.
