import { StatusGlyph } from "@shepherdjerred/console-ui";
import { pillSeverity } from "#client/visuals/pill.ts";
import { Loaded } from "@shepherdjerred/loaded";
import { LoadingBlock } from "@shepherdjerred/loaded/react.tsx";
import { TOOL_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeading } from "#client/ops/ops-ui.tsx";
import { StaleNotice } from "#client/stale-notice.tsx";
import type { ReportRunDetail } from "#shared/reports-schema";
import "#styles/engineering.css";
import "#styles/reports.css";
import "#styles/visuals.css";

import {
  DetailViewTabs,
  EmailPreviewPanel,
  useDetailViewMode,
} from "./email-preview-panel.tsx";
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
  verdictLabel,
  verdictToSeverity,
} from "./reports-format.ts";

export function ReportRunBody({
  detail,
}: {
  readonly detail: ReportRunDetail;
}): React.JSX.Element {
  const { viewMode, setView } = useDetailViewMode();
  const [highlightedReceiptId, setHighlightedReceiptId] = useState<
    string | null
  >(null);
  const { report } = detail;
  const delivery = deliveryStatusMeta(detail.deliveryStatus);

  return (
    <>
      <Link className="back-link" to="/reports">
        <ArrowLeftIcon aria-hidden="true" /> Reports
      </Link>

      <div className="rep-heading-badges">
        <StatusGlyph severity={verdictToSeverity(report.verdict)} />
        <span className="visual-pill">
          {verdictLabel(report.verdict)} · {report.execution}
        </span>
        <span className="visual-pill" data-sev={pillSeverity(delivery.tone)}>
          {delivery.label}
        </span>
        <code className="rep-mailbox-chip">{detail.mailboxTo}</code>
      </div>

      <PageHeading meta={detail.eyebrow} title={detail.subject}>
        <>
          {report.remediation?.prUrl === undefined ? null : (
            <a
              className="ui-btn"
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
              className="ui-btn"
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
        </>
      </PageHeading>

      <p className="rep-finding-detail">{report.headline}</p>

      <DetailViewTabs
        ariaLabel="Report detail view"
        idPrefix="run-view"
        viewMode={viewMode}
        onSelect={setView}
      />

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
