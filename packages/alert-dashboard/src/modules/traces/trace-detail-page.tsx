import { StatusGlyph } from "@shepherdjerred/console-ui";
import { pillSeverity } from "#client/visuals/pill.ts";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import type { TraceDetail } from "@shepherdjerred/llm-observability/llm-traces";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  grafanaLokiTraceExploreUrl,
  temporalWorkflowLink,
  TOOL_HOSTS,
} from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useId } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { z } from "zod";

import { PageHeading } from "#client/ops/ops-ui.tsx";
import { UrlTabBar } from "#client/ops/pages/cluster-page.tsx";
import { isReportsNotFound } from "#client/reports/reports-api.ts";
import { EngKpiStrip } from "#client/reports/reports-page.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import { formatValue } from "#shared/ops-format";
import "#styles/engineering.css";
import "#styles/platform.css";
import "#styles/reports.css";
import "#styles/visuals.css";
import "./traces.css";

import { traceDetailQuery } from "./traces-api.ts";
import { ageFromEpochMs, formatUsdTrace } from "./traces-format.ts";
import { TrajectoryCard } from "./trajectory-cards.tsx";
import {
  ArchiveAttributesPanel,
  WaterfallInspector,
} from "./waterfall-panel.tsx";

const DETAIL_TABS = ["trajectory", "waterfall", "archive"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

const DETAIL_TAB_LABELS: Readonly<Record<DetailTab, string>> = {
  trajectory: "Trajectory",
  waterfall: "Waterfall",
  archive: "Archive & attributes",
};

function parseDetailTab(raw: string | null): DetailTab {
  return raw === "waterfall" || raw === "archive" ? raw : "trajectory";
}

function buildDetailKpis(detail: TraceDetail): readonly {
  readonly label: string;
  readonly val: string;
  readonly hint: string;
  readonly sev: Severity;
}[] {
  const { totals } = detail;
  const costVal =
    totals.hasSubscriptionCalls && totals.catalogCostUsd === 0
      ? totals.notionalSubscriptionUsd > 0
        ? `Subscription est. ${formatUsdTrace(totals.notionalSubscriptionUsd)}`
        : "Subscription"
      : formatUsdTrace(totals.catalogCostUsd);
  const subjectText =
    detail.subject === null
      ? "No subject attribution"
      : `${detail.subject.kind}:${detail.subject.id}`;
  const costHint =
    totals.hasSubscriptionCalls && totals.catalogCostUsd > 0
      ? `Subscription est. ${formatUsdTrace(totals.notionalSubscriptionUsd)} · ${subjectText}`
      : subjectText;

  return [
    {
      label: "Duration",
      val: formatValue(detail.durationMs, "ms"),
      hint: `Started ${ageFromEpochMs(detail.startedAtMs)}`,
      sev: "ok",
    },
    {
      label: "Spans & LLM calls",
      val: `${String(detail.spanCount)} / ${String(detail.llmCallCount)}`,
      hint:
        detail.errorSpanCount > 0
          ? `${String(detail.errorSpanCount)} errored span(s)`
          : `${String(detail.llmCallCount)} trajectory step(s)`,
      sev: detail.status === "error" ? "error" : "ok",
    },
    {
      label: "Input · cached tokens",
      val: formatValue(totals.inputTokens, "tokens"),
      hint: `${formatValue(totals.cachedInputTokens, "tokens")} cached · ${formatValue(totals.cacheCreationTokens, "tokens")} write`,
      sev: "ok",
    },
    {
      label: "Output · reasoning tokens",
      val: formatValue(totals.outputTokens, "tokens"),
      hint: `${formatValue(totals.reasoningTokens, "tokens")} reasoning tokens`,
      sev: "ok",
    },
    {
      label: "Cost & attribution",
      val: costVal,
      hint: costHint,
      sev: "info",
    },
  ];
}

const BackTracesStateSchema = z.object({
  fromTracesSearch: z.string().startsWith("?"),
});

function resolveBackTracesHref(state: unknown): string {
  const parsed = BackTracesStateSchema.safeParse(state);
  return parsed.success ? `/traces${parsed.data.fromTracesSearch}` : "/traces";
}

function TraceDetailBody({
  detail,
}: {
  readonly detail: TraceDetail;
}): React.JSX.Element {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const baseId = useId();
  const activeTab = parseDetailTab(params.get("tab"));
  const backHref = resolveBackTracesHref(location.state);

  const lokiUrl = grafanaLokiTraceExploreUrl({
    grafanaUrl: TOOL_HOSTS.grafana,
    traceId: detail.traceId,
    fromMs: detail.startedAtMs,
    toMs: detail.startedAtMs + (detail.durationMs ?? 60_000),
  });
  const workflowLink =
    detail.temporalWorkflowId === null
      ? null
      : temporalWorkflowLink(detail.temporalWorkflowId);
  const kpis = buildDetailKpis(detail);

  return (
    <>
      <Link className="back-link" to={backHref}>
        <ArrowLeftIcon aria-hidden="true" /> Traces
      </Link>

      <div className="rep-heading-badges">
        <StatusGlyph severity={detail.status === "error" ? "error" : "ok"} />
        <span
          className="visual-pill"
          data-sev={pillSeverity(
            detail.source === "tempo" ? "info" : "warning",
          )}
        >
          {detail.source === "tempo"
            ? "Tempo · Full trace"
            : "SeaweedFS · 365d archive"}
        </span>
        {detail.providers.map((provider) => (
          <span key={provider} className="visual-pill">
            {provider}
          </span>
        ))}
        {detail.models.map((model) => (
          <span key={model} className="visual-pill" data-sev="info">
            {model}
          </span>
        ))}
        <code className="rep-mailbox-chip">{detail.traceId}</code>
      </div>

      <PageHeading
        meta={`${detail.rootService}${detail.environment === null ? "" : ` · ${detail.environment}`}`}
        title={detail.rootSpanName}
      >
        <>
          <a className="ui-btn" href={lokiUrl} target="_blank" rel="noreferrer">
            <span>Correlated Loki logs</span>
            <ExternalLinkIcon aria-hidden="true" />
          </a>
          {workflowLink === null ? null : (
            <a
              className="ui-btn"
              href={workflowLink.url}
              target="_blank"
              rel="noreferrer"
            >
              <span>Temporal workflow</span>
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          )}
        </>
      </PageHeading>

      {detail.source === "archive" ? (
        <section
          className="eng-callout eng-callout-warning"
          aria-label="Archived trace reconstruction"
        >
          <div className="eng-callout-body">
            <p className="eng-callout-title">
              Tempo&apos;s 30-day trace retention window has expired —
              reconstructed {String(detail.spanCount)} archived LLM span(s) from
              SeaweedFS <code>llm-archive</code>.
            </p>
          </div>
        </section>
      ) : null}

      <EngKpiStrip className="traces-kpi-grid" items={kpis} />

      <UrlTabBar
        baseId={`${baseId}-tab`}
        label="Trace inspector views"
        tabs={DETAIL_TABS}
        labels={DETAIL_TAB_LABELS}
        active={activeTab}
        onSelect={(next) => {
          const updated = new URLSearchParams(params);
          if (next === "trajectory") {
            updated.delete("tab");
          } else {
            updated.set("tab", next);
          }
          setParams(updated, { replace: true });
        }}
      />

      <div
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${activeTab}`}
        className="traces-tabpanel"
      >
        {activeTab === "trajectory" ? (
          detail.trajectory.length === 0 ? (
            <div className="panel empty-state">
              No normalized LLM trajectory items were found in this trace.
            </div>
          ) : (
            detail.trajectory.map((item, idx) => (
              <TrajectoryCard key={item.spanId} item={item} index={idx} />
            ))
          )
        ) : activeTab === "waterfall" ? (
          <WaterfallInspector
            spans={detail.waterfall}
            totalDurationMs={detail.durationMs}
          />
        ) : (
          <ArchiveAttributesPanel
            archiveRefs={detail.archiveRefs}
            rootSpan={detail.waterfall[0]}
          />
        )}
      </div>
    </>
  );
}

function TraceDetailLoader({
  traceId,
}: {
  readonly traceId: string;
}): React.JSX.Element {
  const detail = Loaded.fromQuery(useQuery(traceDetailQuery(traceId)));

  return (
    <main className="eng-page traces-detail-page">
      <title>Trace · Hub</title>
      <LoadingBlock
        values={{ detail }}
        fallback={<div className="loading-state">Loading trace…</div>}
        renderError={(errors) =>
          isReportsNotFound(errors[0].error) ? (
            <div className="empty-state">Trace not found.</div>
          ) : (
            <div className="error-state">Trace detail is unavailable.</div>
          )
        }
      >
        {({ detail: value }, meta) => (
          <>
            <title>{`${value.rootSpanName} · Hub`}</title>
            <StaleNotice errors={meta.errors} />
            <TraceDetailBody detail={value} />
          </>
        )}
      </LoadingBlock>
    </main>
  );
}

export function TraceDetailPage(): React.JSX.Element {
  const params = useParams();
  const traceId = params["traceId"]?.trim();
  if (traceId === undefined || traceId.length === 0) {
    return (
      <main className="eng-page traces-detail-page">
        <title>Trace not found · Hub</title>
        <div className="empty-state">Trace not found.</div>
      </main>
    );
  }
  return <TraceDetailLoader traceId={traceId} />;
}
