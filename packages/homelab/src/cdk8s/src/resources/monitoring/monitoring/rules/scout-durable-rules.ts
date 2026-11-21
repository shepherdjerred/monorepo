import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "./shared.ts";

/**
 * The durable V2 pipeline's alerts: the beta acceptance checklist, made to page.
 *
 * Its own group rather than rules scattered into `scout-temporal` and
 * `scout-bot-health` because these share a lifetime. They exist to make a
 * migration observable, they are read together during it, and whoever decides
 * the V2 rollout is finished should be able to find every rule that informed
 * that decision in one place.
 *
 * ## Why every rule here carries an `absent()` guard
 *
 * Every gauge here is filled by a database sweep that exactly one runtime role
 * runs (`metrics/sweep-policy.ts`), which makes "the backlog is empty" and "the
 * role that measures the backlog is not running" produce the same silence from
 * a threshold rule. That is the failure this group most has to survive: a
 * misconfigured rollout that stopped the sweep would otherwise turn every alert
 * below green at the moment they are needed. The repo has no promtool step and
 * nothing cross-checks a metric name in a rule against the backend source, so
 * `absent()` is also what catches a rule pointed at a metric no process emits —
 * see the same pattern in `scout-temporal-rules.ts`.
 *
 * A sweep can fail in two shapes and they need two different rules, which is a
 * correction to what this comment used to claim. `absent()` catches the shape
 * where nothing publishes at all. It does NOT catch the shape where the sweep
 * runs, fails its reads, and writes the -1 sentinel: that series is present and
 * below every threshold, so it satisfies neither half of an ordinary rule.
 * `ScoutDurableSweepFailing` is the rule for that, and the reason it is not
 * folded into the threshold rules is that -1 does not mean "a small backlog",
 * it means "no measurement" — an alert that conflated them would report a
 * number it does not have.
 *
 * ## Why none of these name a role
 *
 * Every gauge here is produced by whichever role owns the database sweeps —
 * `application` in both stages — and the rules deliberately do not
 * say which. They ask whether the answer exists and what it says, so they need
 * no edit when a stage's sweep owner changes.
 *
 * ## If you come here to add a stalled-notification alert
 *
 * Write it against the DEPTH of the drivable intent states on
 * `scout_durable_notification_intents` — `pending`, `ready`, `sending` — and not
 * against a backlog age. There is deliberately no
 * `family="stalled-notifications"` series to reach for: the read behind that
 * family orders by `freshnessDeadline`, so its head is the intent closest to
 * EXPIRING rather than the one that has waited longest. Published as an age it
 * would run backwards — healthiest-looking exactly when the queue is most
 * urgent — so the gauge was left out rather than shipped pointing the wrong
 * way. Depth answers the same operational question honestly: drivable states
 * climbing while the settled ones do not is a sender that has stopped draining.
 *
 * The one age that IS honest is `family="ready-notification-intents"`: a single
 * state read by `createdAt`, so its head really is the intent that has waited
 * longest. `ScoutDurableReadyIntentsNotDelivered` is written against it.
 */

/** One environment guard, spelled once, for the two environments that page. */
function absentInBothEnvironments(selector: string): string {
  return `absent(${selector}{environment="beta"}) or absent(${selector}{environment="prod"})`;
}

export function getScoutDurableRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "scout-durable",
    rules: [
      {
        // A start row is written BEFORE Temporal is called, so a request that
        // is never acknowledged is the signature of a requester that died in
        // the gap, or of a Temporal that is accepting nothing. Either way the
        // work is recorded and not running, which is the one state the durable
        // design exists to make recoverable — but only if somebody looks.
        alert: "ScoutDurableWorkflowStartStranded",
        annotations: {
          summary: "Scout background job failed to start",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has a V2 workflow start request unaccepted for over 15 minutes, leaving durably recorded work unstarted. Check the unaccepted-starts queue in the operations console and Temporal supervisor health to adopt the existing request without creating a duplicate run.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_backlog_oldest_age_seconds{family="unaccepted-workflow-starts"}) > 900) or ${absentInBothEnvironments("scout_durable_backlog_oldest_age_seconds")}`,
        ),
        for: "10m",
        labels: { severity: "critical" },
      },
      {
        // `conflict` means one fact was recorded twice with two different
        // claims about it (the duplicate signal on the V2 acceptance checklist).
        // A plain retry of a committed write answers `already-applied` and is
        // deliberately not counted here — the repository excludes `recordedAt`
        // from the comparison precisely so ordinary Activity retries stop
        // inflating this signal.
        alert: "ScoutDurableReceiptConflicts",
        annotations: {
          summary: "Scout durable receipts are conflicting",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} recorded conflicting durable receipt evidence for the same match, kind, version, and scope, indicating competing writers produced different results while the first receipt was kept. Inspect recent durable receipt rows and workflow histories to find the duplicate writer before advancing rollouts.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          'sum by (environment) (increase(scout_durable_receipts_recorded_total{outcome="conflict"}[30m])) > 0',
        ),
        for: "5m",
        labels: { severity: "warning" },
      },
      {
        // Not a rate: one unknown delivery is a user who may or may not have
        // been told something, and nothing may retry it automatically because a
        // retry is how that user gets told twice. It needs a human, so it pages
        // on the first one and keeps paging until an operator resolves it.
        alert: "ScoutDurableUnknownDeliveries",
        annotations: {
          summary: "Scout notification intents are stuck in unknown delivery",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} holds notification intents whose Discord send response never arrived, and automatic retries are paused to prevent duplicate posts. Check whether each message landed in Discord, then resolve the intents in the operations console or with toolkit scout ops resolve-unknown.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_notification_intents{state="unknown-delivery"}) > 0) or ${absentInBothEnvironments("scout_durable_notification_intents")}`,
        ),
        for: "15m",
        labels: { severity: "warning" },
      },
      {
        // A batch short of `complete` or `abandoned` holds the only record of
        // where its scan reached, so one sitting for six hours is not slow
        // progress — it is a driver that died and a scan position nobody is
        // advancing.
        alert: "ScoutDurableRecoveryBacklogStale",
        annotations: {
          summary: "Scout durable recovery batch is stalled",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has a recovery batch active for over 6 hours without finishing, leaving backlog recovery stalled at its last scan position. Inspect the batch in the operations console and check its driver workflow before starting a replacement batch.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_backlog_oldest_age_seconds{family="live-recovery-batches"}) > 21600) or ${absentInBothEnvironments("scout_durable_backlog_oldest_age_seconds")}`,
        ),
        for: "30m",
        labels: { severity: "warning" },
      },
      {
        // Per artifact kind on purpose. Matches, timelines and prematch
        // payloads stage independently, and a rule that folded them would stay
        // green while timelines fell days behind a healthy match flow.
        alert: "ScoutDurableLakeStagingLag",
        annotations: {
          summary: "Scout report lake is lagging behind the raw archive",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} archived {{ $labels.artifact_kind }} data over 2 hours ago that has not staged into the report lake, leaving Explore and scheduled report queries incomplete while raw S3 data remains safe. Check lake staging workflows, lake queue workers, and SeaweedFS connectivity.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment, artifact_kind) (scout_durable_lake_staging_lag_seconds) > 7200) or ${absentInBothEnvironments("scout_durable_lake_staging_lag_seconds")}`,
        ),
        for: "30m",
        labels: { severity: "warning" },
      },
      {
        // The zero-mint signal. A 28-hour prod outage ran the V2 core to
        // completion without minting one postmatch intent, and nothing above
        // saw it: nothing was stalled or failing, and the notification scan
        // only drives intents that exist. The gauge counts finished live V2
        // matches that an unmuted, unfiltered subscription was owed a report
        // for, with no postmatch intent and no render receipt. It is an
        // under-count by construction (queue-filtered subscriptions are left
        // out because the queue type is not in the database), so it reads 0
        // on a correct deployment and one is enough to mean a user was not
        // told. Against prod history it counts exactly the outage window.
        // Note: pre-rename workflow histories record `mintPostmatchNotificationIntentsV2`
        // inside `scoutMatchProcessingV2Workflow`.
        alert: "ScoutDurablePostmatchIntentsNotMinted",
        annotations: {
          summary: "Scout finished live matches without minting reports",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} finished processing {{ $value }} live match(es) in the last 6 hours without minting or rendering owed post-match reports, so subscribed channels will never receive them. Inspect mintPostmatchNotificationIntents in recent scoutMatchProcessingWorkflow histories, then backfill missed reports with scoutSilentPostmatchBackfillWorkflow.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_postmatch_mint_gaps) > 0) or ${absentInBothEnvironments("scout_durable_postmatch_mint_gaps")}`,
        ),
        for: "15m",
        labels: { severity: "critical" },
      },
      {
        // `ready` means rendered and not yet sending, so a healthy sender
        // empties it in seconds. The age is read by `createdAt`, which is a
        // real age (unlike the stalled-notification read's deadline order),
        // and intents a recovery batch deliberately holds are excluded. Thirty
        // minutes is well inside the three-hour post-match freshness window,
        // so the page arrives while most of the queue can still be sent.
        alert: "ScoutDurableReadyIntentsNotDelivered",
        annotations: {
          summary: "Scout ready notifications are not being sent",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has rendered notification intents waiting in the ready queue for over 30 minutes, risking unsent expiry at their freshness deadline. Check notification delivery child workflows and the stalled-notification scan in the reconciliation sweep.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_backlog_oldest_age_seconds{family="ready-notification-intents"}) > 1800) or ${absentInBothEnvironments("scout_durable_backlog_oldest_age_seconds")}`,
        ),
        for: "15m",
        labels: { severity: "critical" },
      },
      {
        // Measured from game START, because the observation row stores
        // `gameCreatedAt` and not the end, so the lag includes the game
        // itself. Healthy p90 is 40-44 minutes on beta and on pre-incident
        // prod (about 39 of that is the game), and it reached 398 minutes in
        // the prod outage. 90 minutes is double the healthy p90, or roughly 50
        // minutes of discovery lag after an average game. An empty window
        // reads 0, so this does not detect discovery that has stopped
        // outright.
        alert: "ScoutDurableObservationLagHigh",
        annotations: {
          summary: "Scout is discovering finished matches late",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} p90 match observation lag exceeds 90 minutes from game start, causing post-match reports to post late or miss their freshness deadline. Check post-match discovery workflows for head-of-line blocking, Riot rate limits, and stalled account cursors.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_observation_lag_seconds{statistic="p90"}) > 5400) or ${absentInBothEnvironments("scout_durable_observation_lag_seconds")}`,
        ),
        for: "30m",
        labels: { severity: "warning" },
      },
      {
        // Discovery that has stopped outright, which the observation lag above
        // cannot see: it reads 0 over an empty window. Measured from the last
        // poll that closed with complete evidence, so it grows whether the run
        // is wedged, its Schedule is not starting runs, or every run fails.
        // Healthy is about a minute; a large catch-up page takes a few. On
        // 2026-10-10 a wedged dispatcher held this at 24 hours while every
        // other rule here stayed green. A planned discovery pause also fires
        // it; silence it for the maintenance window rather than raising it.
        alert: "ScoutDurablePostmatchDiscoveryStalled",
        annotations: {
          summary: "Scout post-match discovery has stalled",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has not completed a post-match discovery poll in over 30 minutes, so finished games are not being detected or reported. Check the postmatch-discovery Temporal schedule, active workflow waits on the shared match dispatcher, and BotState poll status.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_postmatch_poll_age_seconds) > 1800) or ${absentInBothEnvironments("scout_durable_postmatch_poll_age_seconds")}`,
        ),
        for: "10m",
        labels: { severity: "critical" },
      },
      {
        // The guard on the guards. Every other rule in this group reads a gauge
        // one role sweeps, and each carries its own `absent()` — but those fire
        // per family and say nothing about why. This one names the cause once:
        // no pod is composing the durable collector set, so the whole group
        // above is blind rather than clear.
        alert: "ScoutDurableSweepMissing",
        annotations: {
          summary: "Scout durable pipeline metrics are missing",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} is publishing no durable pipeline gauges, leaving backlog, intent, and lake-lag alerts blind. Check that the application pod responsible for database metric sweeps is running and being scraped by Prometheus.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          absentInBothEnvironments("scout_durable_notification_intents"),
        ),
        for: "15m",
        labels: { severity: "critical" },
      },
      {
        // The other half of a broken sweep, and the half that was invisible.
        //
        // A failing sweep does not go quiet: it writes -1 into its age gauges
        // to say "I could not read this". Every threshold rule above asks
        // whether a value is ABOVE a bound, and -1 is below all of them, so a
        // failing sweep satisfied none of them. Their `absent()` guards did not
        // help either — the series is present, it is just lying low rather than
        // missing.
        //
        // `ScoutDurableSweepMissing` covers only the durable sweep's failure,
        // and then only incidentally, because that one clears the intent gauge
        // on its way down. The lake sweep is a separate function with a
        // separate catch: when it alone fails it writes -1 and clears nothing,
        // so nothing above fires and the lake lag reads as perfectly current
        // while being entirely unmeasured. That is the worst shape an
        // observability gap can take, and it is the reason this rule exists.
        //
        // `min` rather than `max`: one -1 among healthy series is the signal,
        // and `max` would be dominated by whichever family is genuinely backed
        // up and hide it.
        alert: "ScoutDurableSweepFailing",
        annotations: {
          summary: "Scout durable pipeline metric sweep is failing",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} failed its durable pipeline database metric sweep, leaving backlog and lag threshold alerts blind with stale values. Check the application pod logs and PostgreSQL health for failing metric sweep queries.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          [
            "scout_durable_backlog_oldest_age_seconds",
            "scout_durable_lake_staging_lag_seconds",
            "scout_durable_observation_lag_seconds",
            "scout_durable_postmatch_mint_gaps",
            "scout_durable_postmatch_poll_age_seconds",
          ]
            .map((metric) => `(min by (environment) (${metric}) < 0)`)
            .join(" or "),
        ),
        for: "15m",
        labels: { severity: "critical" },
      },
    ],
  };
}
