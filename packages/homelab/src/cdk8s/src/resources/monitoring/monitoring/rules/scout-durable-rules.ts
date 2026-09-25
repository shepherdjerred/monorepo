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
 * `combined` in prod, `application` in beta — and the rules deliberately do not
 * say which. They ask whether the answer exists and what it says, so they need
 * no edit when a stage's sweep owner changes and cannot be made wrong by the
 * deferred `activity-worker` role never being deployed.
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
          summary: "A Scout V2 workflow start was never accepted",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has a V2 workflow start request that has gone unaccepted for over 15 minutes. The request is durably recorded and no Workflow is running it. Check the operations console's unaccepted-starts queue and the Temporal supervisor before re-requesting, since adopting the existing request is what prevents a duplicate run.",
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
        // claims about it. A plain retry of a committed write answers
        // `already-applied` and is deliberately not counted here — the
        // repository excludes `recordedAt` from the comparison precisely so
        // that ordinary Activity retries stop inflating this signal.
        alert: "ScoutDurableReceiptConflicts",
        annotations: {
          summary: "Scout durable receipts are conflicting",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} recorded a receipt whose evidence disagreed with the receipt already stored for the same match, kind, version and scope. Something wrote two different claims about one fact; the table kept the first. This is the duplicate signal on the V2 acceptance checklist and should be explained before the rollout advances.",
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
          summary: "Scout has notification intents at the operator dead end",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} is holding notification intents in `unknown-delivery`: the send left and the response never arrived. Nothing will retry these, by design — resolve each one through the operations console after confirming whether the message actually landed.",
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
          summary: "A Scout recovery batch has stalled",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has a recovery batch that has been live for over six hours without reaching a terminal state. The batch row is the only record of how far its scan got. Inspect the recovery queue in the operations console before starting a replacement batch.",
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
          summary: "Scout's report lake is behind the raw archive",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} archived a {{ $labels.artifact_kind }} artifact over two hours ago that the report lake still has no staging receipt for. The raw archive in S3 is canonical and the lake is rebuildable, so nothing is lost — but Explore and every report query are reading a lake that is missing this work.",
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
        alert: "ScoutDurablePostmatchIntentsNotMinted",
        annotations: {
          summary: "Scout finished live matches without minting their reports",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has {{ $value }} live V2 match(es) observed in the last 6 hours whose processing finished at least 15 minutes ago with a subscribed channel owed a report, but no postmatch intent was minted and no report was rendered. Those reports will never be sent. Check `mintPostmatchNotificationIntentsV2` in recent scoutMatchProcessingV2Workflow histories. After fixing the cause, render the missed reports with scoutSilentPostmatchBackfillV2Workflow; the backfill's receipts clear this alert.",
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
          summary: "Scout has ready notifications that nothing is sending",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }}'s oldest `ready` notification intent was minted over 30 minutes ago and has not started sending. Nothing is draining the ready queue, so every report in it will expire unsent at its freshness deadline. Check the notification child workflows and the reconciliation sweep's stalled-notification scan.",
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
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }}'s live matches observed in the last two hours were observed a p90 of over 90 minutes after game start, which includes the game's length. Healthy is about 45 minutes. Reports are going out late or past their freshness deadline. Check post-match discovery runs for head-of-line blocking and account cursors that are not advancing.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(max by (environment) (scout_durable_observation_lag_seconds{statistic="p90"}) > 5400) or ${absentInBothEnvironments("scout_durable_observation_lag_seconds")}`,
        ),
        for: "30m",
        labels: { severity: "warning" },
      },
      {
        // The guard on the guards. Every other rule in this group reads a gauge
        // one role sweeps, and each carries its own `absent()` — but those fire
        // per family and say nothing about why. This one names the cause once:
        // no pod is composing the durable collector set, so the whole group
        // above is blind rather than clear.
        alert: "ScoutDurableSweepMissing",
        annotations: {
          summary: "No Scout pod is sweeping the durable pipeline metrics",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} is publishing no durable pipeline gauges, so every backlog, intent-state and lake-lag alert is blind rather than green. Exactly one runtime role composes these collectors; check that a pod with the database-sweep capability is scheduled and scraping.",
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
          summary: "A Scout durable metric sweep is failing its reads",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} is publishing a durable gauge holding the -1 sentinel, which means a sweep ran and could not read the database. The backlog and lag numbers beside it are stale rather than low, so every threshold alert in this group is currently blind. Check the sweeping pod's logs for the failing query.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          [
            "scout_durable_backlog_oldest_age_seconds",
            "scout_durable_lake_staging_lag_seconds",
            "scout_durable_observation_lag_seconds",
            "scout_durable_postmatch_mint_gaps",
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
