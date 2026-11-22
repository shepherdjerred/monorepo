import type {
  EventWindowCount,
  ExternalReferrer,
  HostWebVitals,
  SiteTrafficSummary,
  TopPage,
} from "@shepherdjerred/ops-clients/posthog.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { PostHogFacet } from "@shepherdjerred/ops-model/facets.ts";
import {
  posthogSiteDau24h,
  posthogSiteLcpP75Ms,
  posthogSitePageviews24h,
} from "#observability/metrics-ops.ts";

type FunnelDefinition = {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly { readonly event: string; readonly label: string }[];
};

export const POSTHOG_FUNNEL_DEFINITIONS: readonly FunnelDefinition[] = [
  {
    id: "scout",
    name: "Scout Onboarding & Delivery",
    steps: [
      { event: "guild_installed", label: "Guild Installed" },
      { event: "first_subscription_created", label: "First Subscription" },
      { event: "first_core_output_delivered", label: "First Output" },
      { event: "core_output_delivered", label: "Core Outputs" },
    ],
  },
  {
    id: "storm",
    name: "The Storm Player Funnel",
    steps: [
      { event: "storm_server_address_copied", label: "Address Copied" },
      { event: "storm_session_started", label: "Session Started" },
      { event: "storm_feature_interacted", label: "Feature Interacted" },
      { event: "storm_session_ended", label: "Session Completed" },
    ],
  },
  {
    id: "streambot",
    name: "Streambot Engagement",
    steps: [
      { event: "streambot_web_signed_in", label: "Web Signed In" },
      { event: "streambot_search_performed", label: "Search Performed" },
      { event: "streambot_play_requested", label: "Play Requested" },
    ],
  },
];

export const POSTHOG_FUNNEL_EVENTS: readonly string[] = [
  ...new Set(
    POSTHOG_FUNNEL_DEFINITIONS.flatMap((funnel) =>
      funnel.steps.map((step) => step.event),
    ),
  ),
];

const ZERO_SERIES_7D = [0, 0, 0, 0, 0, 0, 0];

export function buildPostHogFacet(input: {
  traffic: readonly SiteTrafficSummary[];
  topPages: readonly TopPage[];
  webVitals: readonly HostWebVitals[];
  topReferrers: readonly ExternalReferrer[];
  funnelCounts: readonly EventWindowCount[];
  services: ServiceIndex;
}): PostHogFacet {
  const vitalsByHost = new Map(
    input.webVitals.map((vital) => [vital.host, vital]),
  );
  const seenSiteKeys = new Set<string>();

  const sites: PostHogFacet["sites"] = input.traffic.map((row) => {
    if (row.siteKey !== undefined) {
      seenSiteKeys.add(row.siteKey);
    }
    seenSiteKeys.add(row.host);
    const vitals = vitalsByHost.get(row.host);
    return {
      siteKey: row.siteKey ?? null,
      host: row.host,
      pageviews24h: row.pageviews24h,
      dau24h: row.dau24h,
      wau7d: row.wau7d,
      dailySeries7d:
        row.dailySeries7d.length === 7
          ? row.dailySeries7d
          : [...ZERO_SERIES_7D],
      p75LcpMs: vitals?.lcpP75 ?? null,
      p75InpMs: vitals?.inpP75 ?? null,
      exceptions24h: row.exceptions24h,
      rageclicks24h: row.rageclicks24h,
    };
  });

  // Ensure every catalogued analytics site appears (14+ sites) even with 0 traffic.
  for (const service of input.services.services) {
    for (const analyticsSite of service.analyticsSites) {
      if (!seenSiteKeys.has(analyticsSite)) {
        seenSiteKeys.add(analyticsSite);
        sites.push({
          siteKey: analyticsSite,
          host: analyticsSite,
          pageviews24h: 0,
          dau24h: 0,
          wau7d: 0,
          dailySeries7d: [...ZERO_SERIES_7D],
          p75LcpMs: null,
          p75InpMs: null,
          exceptions24h: 0,
          rageclicks24h: 0,
        });
      }
    }
  }

  sites.sort(
    (a, b) =>
      b.pageviews24h - a.pageviews24h ||
      b.wau7d - a.wau7d ||
      a.host.localeCompare(b.host),
  );

  const countsByEvent = new Map(
    input.funnelCounts.map((entry) => [entry.event, entry]),
  );
  const funnels: PostHogFacet["funnels"] = POSTHOG_FUNNEL_DEFINITIONS.map(
    (definition) => ({
      id: definition.id,
      name: definition.name,
      steps: definition.steps.map((step) => {
        const counts = countsByEvent.get(step.event);
        return {
          label: step.label,
          count24h: counts?.count24h ?? 0,
          count7d: counts?.count7d ?? 0,
        };
      }),
    }),
  );

  return {
    totalPageviews24h: sites.reduce((sum, s) => sum + s.pageviews24h, 0),
    totalDau24h: sites.reduce((sum, s) => sum + s.dau24h, 0),
    totalWau7d: sites.reduce((sum, s) => sum + s.wau7d, 0),
    totalExceptions24h: sites.reduce((sum, s) => sum + s.exceptions24h, 0),
    sites,
    topPages: input.topPages.map((page) => ({
      host: page.host,
      path: page.path,
      pageviews24h: page.pageviews,
    })),
    topReferrers: input.topReferrers.map((ref) => ({
      referrer: ref.domain,
      pageviews24h: ref.count,
    })),
    funnels,
  };
}

export function recordPostHogFacetGauges(facet: PostHogFacet): void {
  posthogSitePageviews24h.reset();
  posthogSiteDau24h.reset();
  posthogSiteLcpP75Ms.reset();
  for (const site of facet.sites) {
    const labels = { site: site.siteKey ?? site.host, host: site.host };
    posthogSitePageviews24h.set(labels, site.pageviews24h);
    posthogSiteDau24h.set(labels, site.dau24h);
    if (site.p75LcpMs !== null) {
      posthogSiteLcpP75Ms.set(labels, site.p75LcpMs);
    }
  }
}
