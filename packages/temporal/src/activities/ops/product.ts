import type {
  SitePageviews,
  TopPage,
} from "@shepherdjerred/ops-clients/posthog.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { metricsLink, POSTHOG_PROJECT_URL } from "./ops-links.ts";
import {
  metric,
  serviceForNamespace,
  truncate,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

/** Blackbox probes: in-cluster/public service probes and static sites. */
export const PROBE_QUERY = 'probe_success{job=~"probe-.*|static-site-.*"}';

/** A readable probe name; `service` is absent on some probes (static sites). */
function probeName(labels: Record<string, string>): string {
  const namespace = labels["namespace"];
  const path = labels["path"];
  if (namespace !== undefined) {
    const service = labels["service"];
    const target =
      service === undefined ? namespace : `${namespace}/${service}`;
    return path === undefined ? target : `${target} (${path})`;
  }
  const site = labels["site"];
  if (site !== undefined) {
    return `${site}${path ?? ""}`;
  }
  const job = labels["job"];
  if (job === undefined) {
    throw new Error("probe_success sample has no job label");
  }
  return job;
}

export function mapProbes(
  samples: readonly PrometheusSample[],
  context: OpsContext,
): OpsCollection {
  const down = samples.filter((sample) => sample.value < 1);
  const staticSites = context.services.byId("static-sites");
  const signals: SignalInput[] = down.map((sample) => {
    const labels = sample.metric;
    const name = probeName(labels);
    const job = labels["job"] ?? "";
    const service = job.startsWith("static-site-")
      ? staticSites === undefined
        ? {}
        : { service: staticSites.id }
      : serviceForNamespace(context, labels["namespace"]);
    return {
      id: `probes:${job}:${labels["instance"] ?? name}`,
      source: "probes",
      section: "product",
      ...service,
      kind: "probe",
      severity: "error",
      needsMe: false,
      title: `${name} is down`,
      attributes: {
        job,
        ...(labels["path"] === undefined ? {} : { path: labels["path"] }),
      },
      links: [
        metricsLink(`Probe ${name}`, `probe_success{job="${job}"}`, "now-6h"),
      ],
    };
  });
  return {
    signals,
    metrics: [
      metric({
        section: "product",
        source: "probes",
        id: METRIC_IDS.probesDown,
        label: "Probes down",
        value: down.length,
        unit: "count",
        severity: down.length > 0 ? "error" : "ok",
      }),
    ],
    changes: [],
  };
}

export function mapPostHog(
  sites: readonly SitePageviews[],
  topPages: readonly TopPage[],
  context: OpsContext,
): OpsCollection {
  const bySite = new Map<string, { pageviews: number; hosts: Set<string> }>();
  for (const row of sites) {
    const key = row.siteKey ?? row.host;
    const entry = bySite.get(key) ?? { pageviews: 0, hosts: new Set<string>() };
    entry.pageviews += row.pageviews;
    entry.hosts.add(row.host);
    bySite.set(key, entry);
  }
  // Every catalogued site gets a signal, so a site with no traffic shows up.
  for (const service of context.services.services) {
    for (const site of service.analyticsSites) {
      if (!bySite.has(site)) {
        bySite.set(site, { pageviews: 0, hosts: new Set() });
      }
    }
  }
  const signals: SignalInput[] = [...bySite.entries()]
    .toSorted(([, left], [, right]) => right.pageviews - left.pageviews)
    .map(([site, entry]) => {
      const service = context.services.byAnalyticsSite(site);
      const hosts = [...entry.hosts];
      const top = topPages
        .filter((page) => entry.hosts.has(page.host))
        .slice(0, 3)
        .map((page) => `${page.path} (${String(page.pageviews)})`);
      return {
        id: `posthog:site:${site}`,
        source: "posthog",
        section: "product",
        ...(service === undefined ? {} : { service: service.id }),
        kind: "site-traffic",
        severity: "ok",
        needsMe: false,
        title: `${site}: ${String(entry.pageviews)} pageviews (24h)`,
        ...(top.length === 0
          ? {}
          : { detail: truncate(`Top: ${top.join(", ")}`, 300) }),
        attributes: {
          pageviews24h: entry.pageviews,
          ...(hosts.length === 0 ? {} : { hosts: hosts.join(", ") }),
        },
        links: [
          {
            kind: "posthog",
            label: "Web analytics",
            url: `${POSTHOG_PROJECT_URL}/web`,
          },
        ],
      };
    });
  return {
    signals,
    metrics: [
      metric({
        section: "product",
        source: "posthog",
        id: METRIC_IDS.pageviews24h,
        label: "Pageviews (24h)",
        value: sites.reduce((total, row) => total + row.pageviews, 0),
        unit: "count",
      }),
    ],
    changes: [],
  };
}
