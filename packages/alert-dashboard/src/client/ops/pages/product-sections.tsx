import type {
  PostHogFacet,
  PostHogFunnel,
  PostHogSite,
  PostHogTopPage,
  PostHogTopReferrer,
} from "@shepherdjerred/ops-model/facets.ts";
import { useMemo, type ReactNode } from "react";

import { ServiceLink, services } from "#client/ops/ops-ui.tsx";
import {
  DataTable,
  Sparkline,
  StackedMeter,
  type DataTableColumn,
} from "#client/visuals/index.ts";
import { formatValue } from "#shared/ops-format";

type LcpClassification = {
  readonly label: "Good" | "Needs Improvement" | "Poor" | "No data";
  readonly glyph: "✓" | "!" | "✕" | "—";
  readonly tone: "ok" | "warning" | "error" | "neutral";
};

function FunnelCard({
  funnel,
  computeRetention,
}: {
  readonly funnel: PostHogFunnel;
  readonly computeRetention: (
    current: number,
    previous: number | null,
  ) => number;
}): React.JSX.Element {
  const entry7d = funnel.steps[0]?.count7d ?? 0;
  const final7d = funnel.steps.at(-1)?.count7d ?? 0;
  const overall7d = computeRetention(final7d, Math.max(entry7d, 0));

  return (
    <article className="product-funnel-card" aria-label={funnel.name}>
      <header className="product-funnel-head">
        <h3>{funnel.name}</h3>
        <span className="visual-pill visual-pill-info">{`${String(overall7d)}% 7d conversion`}</span>
      </header>
      <StackedMeter
        label="7d entry outcome"
        segments={[
          {
            key: "converted",
            label: "Completed funnel",
            value: final7d,
            color: "var(--status-good)",
          },
          {
            key: "dropoff",
            label: "Drop-off",
            value: Math.max(0, entry7d - final7d),
            color: "var(--status-unknown)",
          },
        ]}
      />
      <ol className="product-funnel-steps">
        {funnel.steps.map((step, index) => {
          const prev7d =
            index === 0 ? null : (funnel.steps[index - 1]?.count7d ?? 0);
          const stepRetention = computeRetention(step.count7d, prev7d);
          const entryShare =
            entry7d > 0
              ? Math.min(100, Math.max(0, (step.count7d / entry7d) * 100))
              : 0;
          return (
            <li key={step.label} className="product-funnel-step">
              <div className="product-funnel-step-row">
                <span className="product-funnel-step-label">{`${String(index + 1)}. ${step.label}`}</span>
                <span className="product-funnel-step-stats">
                  <span>
                    24h <strong>{formatValue(step.count24h, "count")}</strong>
                  </span>
                  <span>
                    7d <strong>{formatValue(step.count7d, "count")}</strong>
                  </span>
                  <span>
                    {index === 0
                      ? "100% entry"
                      : `${String(stepRetention)}% of prev`}
                  </span>
                </span>
              </div>
              <div className="product-funnel-bar" aria-hidden="true">
                <span
                  className="product-funnel-bar-fill"
                  style={{ width: `${String(Math.round(entryShare))}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function tableCol<T>(
  key: string,
  header: string,
  render: (row: T) => ReactNode,
  opts?: {
    readonly align?: "left" | "right";
    readonly sortValue?: (row: T) => string | number | null | undefined;
    readonly exportValue?: (
      row: T,
    ) => string | number | boolean | null | undefined;
  },
): DataTableColumn<T> {
  return {
    key,
    header,
    render,
    align: opts?.align,
    sortValue: opts?.sortValue,
    exportValue: opts?.exportValue,
  };
}

function buildSiteColumns(
  classifyLcp: (value: number | null) => LcpClassification,
): readonly DataTableColumn<PostHogSite>[] {
  return [
    tableCol(
      "host",
      "Site / Host",
      (site) => {
        const owner =
          site.siteKey === null
            ? undefined
            : services.byAnalyticsSite(site.siteKey);
        return (
          <div className="product-host-cell">
            <span className="product-host-name">{site.host}</span>
            {owner === undefined ? null : <ServiceLink id={owner.id} />}
          </div>
        );
      },
      { sortValue: (s) => s.host, exportValue: (s) => s.host },
    ),
    tableCol(
      "trend",
      "7d Trend",
      (site) => (
        <div className="product-trend-cell">
          <Sparkline
            values={site.dailySeries7d}
            width={84}
            height={22}
            tone="neutral"
          />
          <span className="product-trend-count">
            {site.pageviews24h.toLocaleString("en-US")}
          </span>
        </div>
      ),
      {
        align: "right",
        sortValue: (s) => s.pageviews24h,
        exportValue: (s) => s.pageviews24h,
      },
    ),
    tableCol("dau24h", "DAU (24h)", (s) => s.dau24h.toLocaleString("en-US"), {
      align: "right",
      sortValue: (s) => s.dau24h,
    }),
    tableCol("wau7d", "WAU (7d)", (s) => s.wau7d.toLocaleString("en-US"), {
      align: "right",
      sortValue: (s) => s.wau7d,
    }),
    tableCol(
      "p75Lcp",
      "p75 LCP",
      (site) => {
        const badge = classifyLcp(site.p75LcpMs);
        return (
          <div className="product-cwv-cell">
            <span className="mono">
              {site.p75LcpMs === null
                ? "—"
                : `${String(Math.round(site.p75LcpMs))} ms`}
            </span>
            <span className={`visual-pill visual-pill-${badge.tone}`}>
              <span aria-hidden="true">{badge.glyph}</span>
              {badge.label}
            </span>
          </div>
        );
      },
      {
        align: "right",
        sortValue: (s) => s.p75LcpMs,
        exportValue: (s) => s.p75LcpMs,
      },
    ),
    tableCol(
      "p75Inp",
      "p75 INP",
      (s) =>
        s.p75InpMs === null ? "—" : `${String(Math.round(s.p75InpMs))} ms`,
      {
        align: "right",
        sortValue: (s) => s.p75InpMs,
        exportValue: (s) => s.p75InpMs,
      },
    ),
    tableCol(
      "exceptions",
      "Exceptions (24h)",
      (s) => s.exceptions24h.toLocaleString("en-US"),
      {
        align: "right",
        sortValue: (s) => s.exceptions24h,
      },
    ),
    tableCol(
      "rageclicks",
      "Rageclicks (24h)",
      (s) => s.rageclicks24h.toLocaleString("en-US"),
      {
        align: "right",
        sortValue: (s) => s.rageclicks24h,
      },
    ),
  ];
}

const TOP_PAGE_COLUMNS: readonly DataTableColumn<PostHogTopPage>[] = [
  tableCol(
    "page",
    "Page",
    (row) => (
      <div className="product-cell-stack">
        <span className="product-cell-primary mono">{row.path}</span>
        <span className="product-cell-secondary mono">{row.host}</span>
      </div>
    ),
    {
      sortValue: (r) => `${r.host}${r.path}`,
      exportValue: (r) => `${r.host}${r.path}`,
    },
  ),
  tableCol(
    "pageviews",
    "24h Pageviews",
    (r) => r.pageviews24h.toLocaleString("en-US"),
    {
      align: "right",
      sortValue: (r) => r.pageviews24h,
    },
  ),
];

const TOP_REFERRER_COLUMNS: readonly DataTableColumn<PostHogTopReferrer>[] = [
  tableCol(
    "referrer",
    "External referrer",
    (r) => <span className="mono">{r.referrer}</span>,
    {
      sortValue: (r) => r.referrer,
    },
  ),
  tableCol(
    "pageviews",
    "24h Pageviews",
    (r) => r.pageviews24h.toLocaleString("en-US"),
    {
      align: "right",
      sortValue: (r) => r.pageviews24h,
    },
  ),
];

export function ProductPostHogSections({
  posthog,
  classifyLcp,
  computeRetention,
}: {
  readonly posthog: PostHogFacet;
  readonly classifyLcp: (value: number | null) => LcpClassification;
  readonly computeRetention: (
    current: number,
    previous: number | null,
  ) => number;
}): React.JSX.Element {
  const siteColumns = useMemo(
    () => buildSiteColumns(classifyLcp),
    [classifyLcp],
  );
  return (
    <>
      {posthog.funnels.length === 0 ? null : (
        <section aria-labelledby="product-funnels-heading">
          <h2 className="block-heading" id="product-funnels-heading">
            Conversion funnels
          </h2>
          <div className="product-funnel-grid">
            {posthog.funnels.map((funnel) => (
              <FunnelCard
                key={funnel.id}
                funnel={funnel}
                computeRetention={computeRetention}
              />
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="product-sites-heading">
        <h2 className="block-heading" id="product-sites-heading">
          Site traffic & Core Web Vitals
        </h2>
        <DataTable
          caption="PostHog sites traffic and Core Web Vitals"
          hideCaption
          rows={posthog.sites}
          rowKey={(site) => site.host}
          rowLabel={(site) => site.host}
          columns={siteColumns}
          defaultSort={{ key: "trend", direction: "descending" }}
          searchPlaceholder="Filter sites or hosts…"
          searchText={(site) => `${site.host} ${site.siteKey ?? ""}`}
          exportFilename="posthog-sites"
          initialCap={20}
          emptyMessage="No PostHog sites reported."
        />
      </section>
      <section aria-labelledby="product-pages-referrers-heading">
        <h2 className="block-heading" id="product-pages-referrers-heading">
          Top pages & external referrers
        </h2>
        <div className="product-split-grid">
          <DataTable
            caption="Top pages (24h)"
            rows={posthog.topPages}
            rowKey={(row) => `${row.host}${row.path}`}
            columns={TOP_PAGE_COLUMNS}
            defaultSort={{ key: "pageviews", direction: "descending" }}
            initialCap={10}
            emptyMessage="No top pages recorded in the last 24h."
          />
          <DataTable
            caption="Top external referrers (24h)"
            rows={posthog.topReferrers}
            rowKey={(row) => row.referrer}
            columns={TOP_REFERRER_COLUMNS}
            defaultSort={{ key: "pageviews", direction: "descending" }}
            initialCap={10}
            emptyMessage="No external referrers recorded in the last 24h."
          />
        </div>
      </section>
    </>
  );
}
