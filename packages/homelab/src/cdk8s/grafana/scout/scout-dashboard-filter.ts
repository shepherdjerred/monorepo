import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { SCOUT_GATEWAY_OWNER_ROLES } from "@shepherdjerred/homelab/cdk8s/src/resources/monitoring/monitoring/rules/scout-alert-constants.ts";

export type PrometheusDatasource = { type: string; uid: string };

export const SCOUT_PROMETHEUS_DATASOURCE: PrometheusDatasource = {
  type: "prometheus",
  uid: "Prometheus",
};

/**
 * The label selector every Scout panel filters by.
 *
 * ## Why it moved here
 *
 * Six modules each declared their own copy of this string. That was survivable
 * while it never changed; it stopped being survivable the moment it had to,
 * because a selector that is right in five files and stale in the sixth
 * produces a dashboard where most panels work and the rest quietly return
 * nothing — the failure mode that looks like an idle system.
 *
 * ## Why `$server` is gone
 *
 * The old variables were both derived from `discord_guilds`, a metric only the
 * pod holding the Discord gateway reports. With one pod that was merely
 * indirect. Split into runtime roles it is wrong in a way that empties the
 * dashboard: beta runs an `application` pod and a `gateway` pod, so the
 * instance list would contain the gateway only, and every panel reading a
 * metric the `application` role produces would filter itself down to no series
 * at all and render as a flat zero.
 *
 * The variables now come from `application_uptime_seconds`, which
 * `getMetrics()` writes on every scrape of every role before any capability
 * check, so the lists describe the whole deployment rather than one subsystem
 * of it. `$role` is new and sits between them: it is the label the backend now
 * stamps on every series from its runtime-role enum, and having it as a
 * variable is what lets one dashboard answer "is this quiet because nothing
 * happened, or because I am looking at a pod that does not do this?".
 *
 * `$instance` keeps the third slot the old `$server` held. It is renamed rather
 * than redefined because it no longer means "Discord server" — that reading was
 * always a coincidence of the metric it was derived from, and keeping the name
 * next to a real `guild` concept invites the wrong one.
 */
export const SCOUT_DASHBOARD_FILTER =
  'environment=~"$environment",role=~"$role",instance=~"$instance"';

export function buildScoutFilter(): string {
  return SCOUT_DASHBOARD_FILTER;
}

/**
 * The filter for a panel reading a gauge only the gateway-owning role produces.
 *
 * Deliberately drops `$role` and pins the roles instead.
 * `discord_connection_status` is a plain gauge, so prom-client exports it as 0
 * from every pod that never opens a shard; with `$role` on All, a `min` over
 * that takes the application pod's truthful 0 and paints the panel red while
 * the bot is connected and posting. The panel is asking about the gateway, so
 * it has to say so rather than inheriting whatever role the operator selected.
 *
 * `$environment` and `$instance` are preserved, so narrowing by stage or by pod
 * still works. Only the role axis is overridden, and only here.
 */
export function buildGatewayOwnerFilter(): string {
  return `environment=~"$environment",role=~"${SCOUT_GATEWAY_OWNER_ROLES.join("|")}",instance=~"$instance"`;
}

/**
 * The metric the variable lists are drawn from.
 *
 * It has to be one every role emits unconditionally, or the variable silently
 * narrows the dashboard to the roles that happen to produce whatever it was
 * derived from. Uptime is written at the top of `getMetrics()`, ahead of the
 * database sweeps and independent of every capability, so it is the one series
 * guaranteed to exist wherever a Scout pod is scraped at all.
 */
const VARIABLE_SOURCE_METRIC = "application_uptime_seconds";

function scoutVariable(
  name: string,
  label: string,
  query: string,
): dashboard.QueryVariableBuilder {
  return new dashboard.QueryVariableBuilder(name)
    .label(label)
    .query(query)
    .datasource(SCOUT_PROMETHEUS_DATASOURCE)
    .multi(true)
    .includeAll(true)
    .allValue(".*");
}

/**
 * Environment, role, and instance, in the order each one narrows the next.
 *
 * Chained so that picking an environment shortens the role list and picking a
 * role shortens the instance list, rather than offering an operator a pod that
 * cannot appear alongside the selection they already made. The role list comes
 * from live label values rather than from a hardcoded set, so a role that is
 * not deployed in a stage simply does not appear there — beta shows
 * `application` and `gateway`, prod shows `combined`.
 */
export function scoutDashboardVariables(): dashboard.QueryVariableBuilder[] {
  return [
    scoutVariable(
      "environment",
      "Environment",
      `label_values(${VARIABLE_SOURCE_METRIC}, environment)`,
    ),
    scoutVariable(
      "role",
      "Runtime role",
      `label_values(${VARIABLE_SOURCE_METRIC}{environment=~"$environment"}, role)`,
    ),
    scoutVariable(
      "instance",
      "Instance",
      `label_values(${VARIABLE_SOURCE_METRIC}{environment=~"$environment",role=~"$role"}, instance)`,
    ),
  ];
}
