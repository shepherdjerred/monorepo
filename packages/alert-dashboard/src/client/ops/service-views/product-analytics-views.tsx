import type {
  BugsinkProjectSummary,
  BugsinkTopIssue,
} from "@shepherdjerred/ops-model/facets.ts";

import {
  extLink,
  FacetSection,
  kpi,
  numCol,
  PresetGrid,
  txtCol,
  type PresetSpec,
} from "./product-view-helpers.tsx";
import { MetricTile } from "#client/ops/ops-ui.tsx";
import { age } from "#client/time.ts";
import {
  DataTable,
  Sparkline,
  StackedMeter,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";
import type { SeriesRange } from "#shared/ops-schema";

const SCOUT_CHARTS: readonly PresetSpec[] = [
  { preset: "scout-guilds", title: "Scout Discord guilds (Prod vs Beta)" },
  { preset: "scout-matches", title: "Scout tracked players", mode: "bar" },
  { preset: "scout-riot-requests", title: "Riot API request rate" },
  {
    preset: "namespace-cpu",
    target: "scout-for-lol",
    title: "Scout namespace CPU",
  },
];

const BUGSINK_ISSUE_COLUMNS: readonly DataTableColumn<BugsinkTopIssue>[] = [
  txtCol(
    "issue",
    "Issue",
    (i) => (
      <div className="product-cell-stack">
        <span className="product-cell-primary mono">{i.type}</span>
        <span className="product-cell-secondary">{i.value}</span>
      </div>
    ),
    (i) => `${i.type} ${i.value}`,
  ),
  txtCol(
    "project",
    "Project",
    (i) => <span className="mono">{i.projectSlug}</span>,
    (i) => i.projectSlug,
  ),
  txtCol(
    "transaction",
    "Transaction",
    (i) => <span className="mono">{i.transaction}</span>,
    (i) => i.transaction,
  ),
  numCol("events", "Events", (i) => i.events),
  {
    key: "lastSeen",
    header: "Last seen",
    align: "right",
    sortValue: (i) => i.lastSeen,
    render: (i) => <time dateTime={i.lastSeen}>{age(i.lastSeen)}</time>,
  },
  {
    key: "link",
    header: "Bugsink",
    align: "right",
    render: (i) => extLink(i.url, `#${i.id}`, `Open Bugsink issue ${i.id}`),
  },
];

const BUGSINK_PROJECT_COLUMNS: readonly DataTableColumn<BugsinkProjectSummary>[] =
  [
    txtCol(
      "name",
      "Project",
      (p) => (
        <div className="product-cell-stack">
          <span className="product-cell-primary">{p.name}</span>
          <span className="product-cell-secondary mono">{p.slug}</span>
        </div>
      ),
      (p) => p.name,
    ),
    numCol("active7d", "Active (7d)", (p) => p.activeIssues7d),
    numCol("stale", "Stale", (p) => p.staleIssues),
    numCol("muted", "Muted", (p) => p.mutedIssues),
    numCol("digested", "Digested events", (p) => p.digestedEventsTotal),
    {
      key: "url",
      header: "Link",
      align: "right",
      render: (p) => extLink(p.url, "Open", `Open ${p.name} in Bugsink`),
    },
  ];

export function ScoutServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <div className="product-scope product-service-stack">
      <PresetGrid
        heading="Scout Prod & Beta telemetry"
        syncKey="scout"
        range={range}
        charts={SCOUT_CHARTS}
      />
      <FacetSection facetKey="posthog" label="Scout PostHog">
        {(posthog) => {
          const sites = posthog.sites.filter(
            (s) =>
              s.host.includes("scout") ||
              (s.siteKey?.includes("scout") ?? false),
          );
          const funnels = posthog.funnels.filter(
            (f) =>
              f.id.includes("scout") || f.name.toLowerCase().includes("scout"),
          );
          return (
            <section
              className="product-service-stack"
              aria-label="Scout analytics"
            >
              <h2 className="block-heading">Scout web & onboarding funnel</h2>
              <div className="product-scout-envs">
                {sites.map((site) => (
                  <article key={site.host} className="product-scout-env-card">
                    <div className="product-funnel-head">
                      <h3 className="mono">{site.host}</h3>
                      <Sparkline
                        values={site.dailySeries7d}
                        width={84}
                        height={22}
                      />
                    </div>
                    <p style={{ margin: 0, fontSize: "0.8rem" }}>
                      {`24h views ${formatValue(site.pageviews24h, "count")} · DAU ${formatValue(site.dau24h, "count")} · WAU ${formatValue(site.wau7d, "count")}`}
                    </p>
                  </article>
                ))}
              </div>
              {funnels.map((f) => (
                <div key={f.id} className="product-meter-card">
                  <h3>{f.name}</h3>
                  <StackedMeter
                    label="7d funnel steps"
                    segments={f.steps.map((s) => ({
                      key: s.label,
                      label: s.label,
                      value: s.count7d,
                    }))}
                  />
                </div>
              ))}
            </section>
          );
        }}
      </FacetSection>
      <FacetSection facetKey="bugsink" label="Scout Bugsink">
        {(bugsink) => (
          <section className="product-service-stack" aria-label="Scout errors">
            <h2 className="block-heading">Scout unresolved issues</h2>
            <DataTable
              caption="Scout unresolved Bugsink issues"
              hideCaption
              rows={bugsink.topIssues.filter(
                (i) =>
                  i.projectSlug === "scout-for-lol" ||
                  i.projectSlug === "sentinel",
              )}
              rowKey={(i) => i.id}
              columns={BUGSINK_ISSUE_COLUMNS}
              initialCap={10}
              emptyMessage="No unresolved Scout issues in Bugsink."
            />
          </section>
        )}
      </FacetSection>
    </div>
  );
}

export function BugsinkServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <div className="product-scope product-service-stack">
      <FacetSection facetKey="bugsink" label="Bugsink">
        {(bugsink) => (
          <>
            <div className="product-kpi-grid">
              <MetricTile
                metric={kpi(
                  "bugsink.unresolved",
                  "Total Unresolved Issues",
                  bugsink.totalUnresolved,
                  {
                    severity: bugsink.totalUnresolved > 0 ? "warning" : "ok",
                    source: "bugsink",
                  },
                )}
              />
              <MetricTile
                metric={kpi(
                  "bugsink.digested",
                  "Total Digested Events",
                  bugsink.totalDigestedEvents,
                  { source: "bugsink" },
                )}
              />
            </div>
            <PresetGrid
              heading="Error trends"
              syncKey="bugsink"
              range={range}
              charts={[
                { preset: "bugsink-unresolved" },
                { preset: "bugsink-events-by-project", mode: "bar" },
              ]}
            />
            <h2 className="block-heading">Projects error summary</h2>
            <DataTable
              caption="Bugsink projects error summary"
              hideCaption
              rows={bugsink.projects}
              rowKey={(p) => String(p.id)}
              columns={BUGSINK_PROJECT_COLUMNS}
              defaultSort={{ key: "active7d", direction: "descending" }}
              searchPlaceholder="Filter projects…"
              searchText={(p) => `${p.name} ${p.slug}`}
            />
            <h2 className="block-heading">Top unresolved issues triage</h2>
            <DataTable
              caption="Top unresolved Bugsink issues"
              hideCaption
              rows={bugsink.topIssues}
              rowKey={(i) => i.id}
              columns={BUGSINK_ISSUE_COLUMNS}
              defaultSort={{ key: "events", direction: "descending" }}
              searchPlaceholder="Search exception type, message, or transaction…"
              searchText={(i) =>
                `${i.type} ${i.value} ${i.projectSlug} ${i.transaction}`
              }
            />
          </>
        )}
      </FacetSection>
    </div>
  );
}
