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
        // >20% of an hour's observations with at least 20 events (sustained 30m)
        // means a rollout is dropping evidence.
        alert: "ScoutClientQuarantineRateHigh",
        annotations: {
          summary: "Scout Client observations are being quarantined",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} quarantined {{ $value | humanizePercentage }} of Scout Client observations over the last hour, dropping client-captured match evidence. Inspect client observations by quarantine_reason to check for an unverified app version, unresolved player alias, or client clock skew.",
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
        // joining to Riot data. Fires above 30% over 30m with >= 5 failures,
        // sustained for 15m.
        alert: "ScoutClientAliasErrorRateHigh",
        annotations: {
          summary: "Scout Client identity alias lookups are failing",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} failed {{ $value | humanizePercentage }} of League-client identity alias lookups over the last 30 minutes, preventing client observations from joining to Riot player data. Check Riot account-v1 API errors and the client alias backlog.",
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
        // supply one for games Spectator misses. Over a 24-hour window, >50% of
        // client-observed games lacking a prematch with >= 10 games (sustained 1h)
        // says the client's prematch is needed and absent. The sweep_failed
        // series (-1) is excluded so it never counts as a game.
        alert: "ScoutClientGamesWithoutPrematchHigh",
        annotations: {
          summary: "Most Scout Client games are missing prematch capture",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} archived no prematch data for {{ $value | humanizePercentage }} of games observed by Scout Clients in the last 24 hours, degrading prematch loading screens and analysis. Inspect missing prematches by game_kind and check Spectator polling and client prematch uploads.",
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
        // evidence every five minutes, so a row still unreconciled after >1h
        // (sustained 30m) is stuck (a binding that never commits, a payload that
        // no longer validates), not queued. The gauge ignores rows younger than
        // five minutes and quarantined rows, which never complete.
        alert: "ScoutClientReconciliationBacklogStale",
        annotations: {
          summary: "Scout Client evidence reconciliation is stuck",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} has accepted Scout Client evidence waiting {{ $value | humanizeDuration }} for reconciliation despite 5-minute retries, leaving post-game or Clash data uncommitted. Check the client reconciliation backlog depth and inspect client reconciliation activity logs for validation or binding failures.",
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
          summary: "Scout Client backlog metric sweep is failing",
          description: escapePrometheusTemplate(
            "Scout {{ $labels.environment }} failed its Scout Client backlog database sweep, leaving alias backlog, reconciliation lag, and active-device alerts blind. Check the application pod logs and PostgreSQL health for failing client metric queries.",
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
