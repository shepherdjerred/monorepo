import type { GolinkLink } from "@shepherdjerred/ops-model/facets.ts";

import {
  extLink,
  FacetSection,
  numCol,
  PresetGrid,
  txtCol,
  type PresetSpec,
} from "./product-view-helpers.tsx";
import {
  DataTable,
  StackedMeter,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import type { SeriesRange } from "#shared/ops-schema";

const GOLINK_CANONICAL_TIERS = [
  "manual",
  "ingress",
  "site",
  "alias",
  "shortcut",
] as const;

const GOLINK_COLUMNS: readonly DataTableColumn<GolinkLink>[] = [
  txtCol(
    "slug",
    "Shortlink",
    (l) => <code className="mono">{`go/${l.slug}`}</code>,
    (l) => l.slug,
  ),
  txtCol(
    "tier",
    "Tier",
    (l) => <span className="visual-pill visual-pill-info">{l.tier}</span>,
    (l) => l.tier,
  ),
  txtCol(
    "targetUrl",
    "Target URL",
    (l) => extLink(l.targetUrl, l.targetUrl),
    (l) => l.targetUrl,
  ),
  numCol("clicks", "Clicks", (l) => l.clicks),
  txtCol(
    "shadows",
    "Shadows",
    (l) =>
      l.shadows === undefined || l.shadows.length === 0 ? (
        <span className="muted">—</span>
      ) : (
        <div className="product-inline-pills">
          {l.shadows.map((s) => (
            <span
              key={s}
              className="visual-pill visual-pill-warning"
            >{`! Overrides ${s}`}</span>
          ))}
        </div>
      ),
    (l) => l.shadows?.length ?? 0,
  ),
];

export function GolinkServiceView({
  range,
}: {
  readonly range: SeriesRange;
}): React.JSX.Element {
  return (
    <div className="product-scope product-service-stack">
      <FacetSection facetKey="golink" label="Golink">
        {(golink) => {
          const canonicalSet = new Set<string>(GOLINK_CANONICAL_TIERS);
          const tierOrder = [
            ...GOLINK_CANONICAL_TIERS,
            ...Object.keys(golink.countsByTier).filter(
              (t) => !canonicalSet.has(t),
            ),
          ];
          return (
            <>
              <div className="product-meter-card">
                <StackedMeter
                  label="go/ shortlinks by resolution tier"
                  segments={tierOrder.map((t) => ({
                    key: t,
                    label: t,
                    value: golink.countsByTier[t] ?? 0,
                  }))}
                />
              </div>
              <PresetGrid
                heading="Redirect traffic"
                syncKey="golink"
                range={range}
                charts={[{ preset: "golink-redirects", mode: "stacked-area" }]}
              />
              <h2 className="block-heading">
                go/ directory & shadow overrides
              </h2>
              <DataTable
                caption="Golink shortlink directory"
                hideCaption
                rows={golink.links}
                rowKey={(l) => l.slug}
                columns={GOLINK_COLUMNS}
                defaultSort={{ key: "clicks", direction: "descending" }}
                searchPlaceholder="Search go/ slug, tier, target URL, or shadowed route…"
                searchText={(l) =>
                  `go/${l.slug} ${l.tier} ${l.targetUrl} ${(l.shadows ?? []).join(" ")}`
                }
              />
            </>
          );
        }}
      </FacetSection>
    </div>
  );
}

const SIMPLE_SERVICE_VIEWS: Readonly<
  Record<
    string,
    { readonly heading: string; readonly charts: readonly PresetSpec[] }
  >
> = {
  streambot: {
    heading: "Streambot & household media",
    charts: [
      { preset: "media-hdd-usage" },
      { preset: "qbittorrent-throughput" },
      { preset: "plex-watch-hours", mode: "bar" },
      { preset: "namespace-cpu", target: "media" },
    ],
  },
  mail: {
    heading: "Postal mail pipeline",
    charts: [
      { preset: "postal-queued" },
      { preset: "namespace-cpu", target: "postal" },
      { preset: "namespace-memory", target: "postal" },
    ],
  },
  minecraft: {
    heading: "Minecraft server & cluster resources",
    charts: [
      { preset: "storm-players", title: "Online players by edition" },
      {
        preset: "storm-brain-requests",
        mode: "bar",
        title: "Storm Brain companion requests",
      },
      {
        preset: "namespace-cpu",
        target: "minecraft",
        title: "Minecraft namespace CPU",
      },
      {
        preset: "namespace-memory",
        target: "minecraft",
        title: "Minecraft namespace memory",
      },
    ],
  },
  "storm-brain": {
    heading: "Storm Brain companion telemetry",
    charts: [
      {
        preset: "storm-brain-requests",
        mode: "bar",
        title: "Storm Brain companion requests",
      },
      { preset: "storm-players", title: "Online players by edition" },
      {
        preset: "namespace-cpu",
        target: "storm-brain",
        title: "Storm Brain namespace CPU",
      },
      {
        preset: "namespace-memory",
        target: "storm-brain",
        title: "Storm Brain namespace memory",
      },
    ],
  },
  "storm-forum": {
    heading: "Storm Forum telemetry",
    charts: [
      { preset: "storm-players", title: "Online players by edition" },
      {
        preset: "namespace-cpu",
        target: "storm-forum",
        title: "Storm Forum namespace CPU",
      },
      {
        preset: "namespace-memory",
        target: "storm-forum",
        title: "Storm Forum namespace memory",
      },
    ],
  },
};

export function renderSimpleProductAppView(
  id: string,
  range: SeriesRange,
): React.JSX.Element | null {
  const simple = SIMPLE_SERVICE_VIEWS[id];
  return simple === undefined ? null : (
    <div className="product-scope">
      <PresetGrid
        heading={simple.heading}
        syncKey={id}
        range={range}
        charts={simple.charts}
      />
    </div>
  );
}
