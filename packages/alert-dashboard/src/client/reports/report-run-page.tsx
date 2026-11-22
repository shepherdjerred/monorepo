import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { TOOL_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { PageHeading, SeverityBadge } from "#client/ops/ops-ui.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import type { ReportRunDetail } from "#shared/reports-schema";
import "#styles/engineering.css";
import "#styles/reports.css";
import "#styles/visuals.css";

import { EmailPreviewPanel } from "./email-preview-panel.tsx";
import {
  EvidenceReceiptsExplorer,
  ProvenanceAndHistoryPanel,
} from "./report-run-evidence.tsx";
import {
  ChecksBreakdown,
  FindingsExplorer,
  RemediationBanner,
  SynthesisPanel,
} from "./report-run-sections.tsx";
import { isReportsNotFound, reportRunDetailQuery } from "./reports-api.ts";
import {
  deliveryStatusMeta,
  formatPacificFull,
  nextRovingTabIndex,
  parseDetailViewMode,
  verdictLabel,
  verdictToSeverity,
  type DetailViewMode,
} from "./reports-format.ts";

const VIEW_TABS: readonly {
  readonly id: DetailViewMode;
  readonly label: string;
}[] = [
  { id: "inspector", label: "Inspector" },
  { id: "email", label: "Rendered Email" },
];

export function ReportRunBody({
  detail,
}: {
  readonly detail: ReportRunDetail;
}): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const viewMode = parseDetailViewMode(params.get("view"));
  const [highlightedReceiptId, setHighlightedReceiptId] = useState<
    string | null
  >(null);
  const tabRefs = useRef(new Map<DetailViewMode, HTMLButtonElement>());
  const { report } = detail;
  const delivery = deliveryStatusMeta(detail.deliveryStatus);

  const setView = (next: DetailViewMode) => {
    const updated = new URLSearchParams(params);
    if (next === "inspector") {
      updated.delete("view");
    } else {
      updated.set("view", next);
    }
    setParams(updated, { replace: true });
  };

  return (
    <>
      <Link className="back-link" to="/reports">
        <ArrowLeftIcon aria-hidden="true" /> Reports
      </Link>

      <div className="rep-heading-badges">
        <SeverityBadge severity={verdictToSeverity(report.verdict)} />
        <span className="visual-pill visual-pill-neutral">
          {verdictLabel(report.verdict)} · {report.execution}
        </span>
        <span className={`visual-pill visual-pill-${delivery.tone}`}>
          {delivery.label}
        </span>
        <code className="rep-mailbox-chip">{detail.mailboxTo}</code>
      </div>

      <PageHeading eyebrow={detail.eyebrow} title={detail.subject}>
        <div className="heading-actions">
          {report.remediation?.prUrl === undefined ? null : (
            <a
              className="button"
              href={report.remediation.prUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>Review pull request</span>
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          )}
          {report.provenance.temporalUrl === undefined ? null : (
            <a
              className="button"
              href={report.provenance.temporalUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>View workflow run</span>
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          )}
          {report.provenance.repoSha === undefined ? null : (
            <a
              className="button mono"
              href={`${TOOL_HOSTS.github}/commit/${encodeURIComponent(report.provenance.repoSha)}`}
              target="_blank"
              rel="noreferrer"
            >
              <span>Commit {report.provenance.repoSha.slice(0, 12)}</span>
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          )}
        </div>
      </PageHeading>

      <p className="rep-finding-detail">{report.headline}</p>

      <div
        role="tablist"
        aria-label="Report detail view"
        className="eng-tablist"
      >
        {VIEW_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`run-view-tab-${tab.id}`}
            ref={(node) => {
              if (node === null) {
                tabRefs.current.delete(tab.id);
              } else {
                tabRefs.current.set(tab.id, node);
              }
            }}
            role="tab"
            type="button"
            className="eng-tab"
            aria-selected={viewMode === tab.id}
            tabIndex={viewMode === tab.id ? 0 : -1}
            onClick={() => {
              setView(tab.id);
            }}
            onKeyDown={(event) => {
              const nextIdx = nextRovingTabIndex(
                event.key,
                index,
                VIEW_TABS.length,
              );
              const nextTab = nextIdx === null ? undefined : VIEW_TABS[nextIdx];
              if (nextTab !== undefined) {
                event.preventDefault();
                setView(nextTab.id);
                tabRefs.current.get(nextTab.id)?.focus();
              }
            }}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`run-view-panel-${viewMode}`}
        aria-labelledby={`run-view-tab-${viewMode}`}
        className="rep-detail-page"
      >
        {viewMode === "email" ? (
          <EmailPreviewPanel
            htmlBody={detail.htmlBody}
            plainBody={detail.plainBody}
            metadata={[
              { label: "Delivery", value: delivery.label, mono: false },
              {
                label: "From → To",
                value: `${detail.mailboxFrom} → ${detail.mailboxTo}`,
              },
              {
                label: "Message ID",
                value: detail.messageId ?? detail.skipReason ?? "—",
              },
              {
                label: "Accepted",
                value: formatPacificFull(detail.acceptedAt),
              },
            ]}
          />
        ) : (
          <>
            <RemediationBanner report={report} />
            <SynthesisPanel report={report} />
            <FindingsExplorer
              findings={report.findings}
              onSelectReceipt={setHighlightedReceiptId}
            />
            <ChecksBreakdown
              checks={report.checks}
              onSelectReceipt={setHighlightedReceiptId}
            />
            <EvidenceReceiptsExplorer
              evidence={report.evidence}
              highlightedReceiptId={highlightedReceiptId}
            />
            <ProvenanceAndHistoryPanel detail={detail} />
          </>
        )}
      </div>
    </>
  );
}

function ReportRunLoader({ id }: { readonly id: string }): React.JSX.Element {
  const detail = Loaded.fromQuery(useQuery(reportRunDetailQuery(id)));
  return (
    <main className="rep-detail-page">
      <title>Report run · Hub</title>
      <LoadingBlock
        values={{ detail }}
        fallback={<div className="loading-state">Loading report run…</div>}
        renderError={(errors) =>
          isReportsNotFound(errors[0].error) ? (
            <div className="empty-state">Report run not found.</div>
          ) : (
            <div className="error-state">Report run is unavailable.</div>
          )
        }
      >
        {({ detail: value }, meta) => (
          <>
            <title>{`${value.subject} · Hub`}</title>
            <StaleNotice errors={meta.errors} />
            <ReportRunBody detail={value} />
          </>
        )}
      </LoadingBlock>
    </main>
  );
}

export function ReportRunPage(): React.JSX.Element {
  const params = useParams();
  const id = params["id"]?.trim();
  if (id === undefined || id.length === 0) {
    return (
      <main>
        <title>Report run not found · Hub</title>
        <div className="empty-state">Report run not found.</div>
      </main>
    );
  }
  return <ReportRunLoader id={id} />;
}
