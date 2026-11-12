import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { escapePrometheusTemplate } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/shared.ts";

/**
 * Scout Client capture alerts: the evidence each production switch-on step
 * needs, made to fire.
 *
 * Every threshold is conservative on purpose. The client is rolling out to the
 * owner first, so volumes are tiny: each ratio rule also requires an absolute
 * minimum of events, or a single quarantined observation among three would
 * page. None of these absent()-guard their series, because the client may be
 * switched off in a stage and silence is then the right answer; the one gauge
 * family a sweep fills is covered by the explicit -1 sentinel rule instead.
 */
export function getScoutClientRuleGroup(): PrometheusRuleSpecGroups {
  return {
    name: "scout-client",
    rules: [
      {
        // Quarantine is the server refusing client evidence it cannot trust or
        // attribute. A few per day is normal (an app version not yet verified);
        // a fifth of an hour's observations, with at least 20 of them, means
        // a rollout is dropping evidence.
        alert: "ScoutClientQuarantineRateHigh",
        annotations: {
          summary: "Scout Client observations are being quarantined",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} quarantined {{ $value | humanizePercentage }} of Scout Client observations over the last hour (alert above 20% with at least 20 observations). Break the rate down by the quarantine_reason label on scout_client_observations_total; a single reason is usually an unverified app version, an unresolved player alias or a clock problem.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(sum by (environment) (increase(scout_client_observations_total{outcome="quarantined"}[1h])) / sum by (environment) (increase(scout_client_observations_total[1h])) > 0.2) and (sum by (environment) (increase(scout_client_observations_total[1h])) >= 20)`,
        ),
        for: "30m",
        labels: { severity: "warning" },
      },
      {
        // Alias lookups ask Riot who a League-client UUID is. Errors (not 404s,
        // which are counted as not_found) mean client data silently stops
        // joining to Riot data. Five failures and 30% of lookups, sustained.
        alert: "ScoutClientAliasErrorRateHigh",
        annotations: {
          summary: "Scout Client identity alias lookups are failing",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} failed {{ $value | humanizePercentage }} of League-client identity lookups over the last 30 minutes (alert above 30% with at least 5 failures). Players whose lookup failed do not join to Riot data until a later observation retries; check Riot account-v1 errors and the alias backlog gauge.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(sum by (environment) (increase(scout_client_identity_aliases_total{outcome="error"}[30m])) / sum by (environment) (increase(scout_client_identity_aliases_total[30m])) > 0.3) and (sum by (environment) (increase(scout_client_identity_aliases_total{outcome="error"}[30m])) >= 5)`,
        ),
        for: "15m",
        labels: { severity: "warning" },
      },
      {
        // Spectator gives Scout most prematches, and the client only needs to
        // supply one for games Spectator misses. Over a 24-hour window, more
        // than half of client-observed games lacking a prematch, with at least
        // ten games, says the client's prematch is needed and absent. The
        // sweep_failed series (-1) is excluded so it never counts as a game.
        alert: "ScoutClientGamesWithoutPrematchHigh",
        annotations: {
          summary: "Most client-observed games have no prematch",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} archived no prematch for {{ $value | humanizePercentage }} of the games a Scout Client watched start in the last day (alert above 50% with at least 10 games). Spectator is not covering the games the client sees; look at which game_kind drives it.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          `(sum by (environment) (scout_client_games_without_prematch{game_kind!="sweep_failed"}) / sum by (environment) (scout_client_observed_games{game_kind!="sweep_failed"}) > 0.5) and (sum by (environment) (scout_client_observed_games{game_kind!="sweep_failed"}) >= 10)`,
        ),
        for: "1h",
        labels: { severity: "warning" },
      },
      {
        // The reconciliation Activity re-checks accepted post-game and Clash
        // evidence every few minutes, so a row still unreconciled after an hour
        // is stuck (a binding that never commits, a payload that no longer
        // validates), not queued. The gauge ignores rows younger than five
        // minutes and quarantined rows, which never complete.
        alert: "ScoutClientReconciliationBacklogStale",
        annotations: {
          summary: "Scout Client evidence reconciliation is stuck",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has accepted Scout Client evidence that has waited {{ $value | humanizeDuration }} for reconciliation (alert above one hour, sustained 30 minutes). Reconciliation retries every five minutes, so this row is stuck rather than queued; see scout_client_reconciliation_backlog for how many.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "max by (environment) (scout_client_reconciliation_oldest_age_seconds) > 3600",
        ),
        for: "30m",
        labels: { severity: "warning" },
      },
      {
        // -1 means the sweep ran and its reads failed: present and below every
        // threshold, so none of the rules above see it. `min` so one failing
        // series is not masked by a healthy one.
        alert: "ScoutClientCaptureSweepFailing",
        annotations: {
          summary: "Scout Client backlog gauges cannot be measured",
          message: escapePrometheusTemplate(
            "Scout {{ $labels.environment }}'s Scout Client backlog sweep is publishing -1, which means its database reads failed and the alias backlog, reconciliation backlog and active-device gauges hold no measurement. Treat the reconciliation alert as blind until this clears.",
          ),
        },
        expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
          "min by (environment) (scout_client_reconciliation_oldest_age_seconds) < 0",
        ),
        for: "15m",
        labels: { severity: "warning" },
      },
    ],
  };
}
