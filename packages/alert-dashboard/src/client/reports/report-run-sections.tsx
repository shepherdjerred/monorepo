import type {
  ReportCheckV1,
  ReportEnvelopeV1,
  ReportFindingV1,
  ReportRemediationV1,
} from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { ExternalLinkIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { SeverityBadge } from "#client/ops/ops-ui.tsx";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";

export type FindingStateFilter =
  "all" | "active" | "observing" | "recovered" | "suppressed";
export type FindingSeverityFilter = "all" | "critical" | "warning" | "info";

const FINDING_STATES: readonly {
  readonly id: FindingStateFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "All states" },
  { id: "active", label: "Active" },
  { id: "observing", label: "Observing" },
  { id: "recovered", label: "Recovered" },
  { id: "suppressed", label: "Suppressed" },
];

const FINDING_SEVERITIES: readonly {
  readonly id: FindingSeverityFilter;
  readonly label: string;
}[] = [
  { id: "all", label: "All severities" },
  { id: "critical", label: "Critical" },
  { id: "warning", label: "Warning" },
  { id: "info", label: "Info" },
];

function normalizedFindingState(
  finding: ReportFindingV1,
): Exclude<FindingStateFilter, "all"> {
  return finding.state ?? "active";
}

function findingSeverityToOps(
  severity: ReportFindingV1["severity"],
): "error" | "warning" | "info" {
  switch (severity) {
    case "critical":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
  }
}

function RemediationHeader({
  rem,
}: {
  readonly rem: ReportRemediationV1 | undefined;
}): React.JSX.Element {
  return (
    <div className="rep-remediation-head">
      <div className="eng-pill-row">
        <h2 className="rep-panel-title">Remediation &amp; next steps</h2>
        {rem === undefined ? null : (
          <>
            <span className="visual-pill visual-pill-info">{rem.outcome}</span>
            {rem.autoMergeEnabled === undefined ? null : (
              <span
                className={`visual-pill visual-pill-${rem.autoMergeEnabled ? "ok" : "warning"}`}
              >
                {rem.autoMergeEnabled
                  ? "Auto-merge enabled"
                  : "Awaiting human review"}
              </span>
            )}
          </>
        )}
      </div>

      {rem?.prUrl === undefined ? null : (
        <a
          className="eng-ext-link"
          href={rem.prUrl}
          target="_blank"
          rel="noreferrer"
        >
          {rem.autoMergeEnabled === true
            ? "View auto-merge PR"
            : "Review pull request"}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      )}
    </div>
  );
}

function RemediationMetaBlock({
  rem,
}: {
  readonly rem: ReportRemediationV1;
}): React.JSX.Element {
  const entries: readonly (readonly [string, string])[] = [
    ...(rem.branchName === undefined
      ? []
      : ([["Branch", rem.branchName]] as const)),
    ...(rem.commitSha === undefined
      ? []
      : ([["Remediation commit", rem.commitSha.slice(0, 12)]] as const)),
    ...(rem.resolvedCount === undefined
      ? []
      : ([["Resolved", String(rem.resolvedCount)]] as const)),
    ...(rem.unresolvedCount === undefined
      ? []
      : ([["Unresolved", String(rem.unresolvedCount)]] as const)),
  ];

  return (
    <>
      {rem.summary === undefined ? null : (
        <p className="rep-finding-detail">{rem.summary}</p>
      )}
      {entries.length === 0 ? null : (
        <dl className="rep-meta-grid">
          {entries.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {rem.changedFiles.length === 0 ? null : (
        <div className="eng-pill-row">
          <span className="rep-cell-sub">Changed files:</span>
          {rem.changedFiles.map((file) => (
            <code key={file} className="visual-branch-chip">
              {file}
            </code>
          ))}
        </div>
      )}
    </>
  );
}

export function RemediationBanner({
  report,
}: {
  readonly report: ReportEnvelopeV1;
}): React.JSX.Element | null {
  const rem = report.remediation;
  const hasActions = report.actions.length > 0;
  const hasRetirement = report.retirementRecommendation !== undefined;
  if (rem === undefined && !hasActions && !hasRetirement) {
    return null;
  }

  const awaitingReview =
    rem?.autoMergeEnabled === false ||
    hasActions ||
    report.verdict === "attention";

  return (
    <section
      className={`rep-remediation-banner${awaitingReview ? " rep-remediation-banner-review" : ""}`}
      aria-label="Remediation and next steps"
    >
      <RemediationHeader rem={rem} />
      {rem === undefined ? null : <RemediationMetaBlock rem={rem} />}
      {report.retirementRecommendation === undefined ? null : (
        <p className="rep-finding-detail">
          <strong>Retirement recommendation:</strong>{" "}
          {report.retirementRecommendation}
        </p>
      )}
      {hasActions ? (
        <ul className="rep-remediation-list">
          {report.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function SynthesisPanel({
  report,
}: {
  readonly report: ReportEnvelopeV1;
}): React.JSX.Element | null {
  if (report.synthesis === undefined && report.limitations.length === 0) {
    return null;
  }
  return (
    <section
      className="panel rep-section-panel"
      aria-labelledby="rep-synthesis-heading"
    >
      <h2 className="rep-panel-title" id="rep-synthesis-heading">
        Synthesis &amp; coverage boundaries
      </h2>
      {report.synthesis === undefined ? null : (
        <p className="rep-finding-detail">{report.synthesis}</p>
      )}
      {report.limitations.length === 0 ? null : (
        <div>
          <h3 className="rep-sub-heading">Not covered / limitations</h3>
          <ul className="rep-remediation-list">
            {report.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ReceiptChips(p: {
  readonly ids: readonly string[];
  readonly onSelectReceipt: (id: string) => void;
}): React.JSX.Element | null {
  if (p.ids.length === 0) return null;
  return (
    <div className="eng-pill-row">
      {p.ids.map((id) => (
        <a
          key={id}
          href={`#receipt-${id}`}
          className="rep-receipt-chip mono"
          onClick={() => {
            p.onSelectReceipt(id);
          }}
        >
          #{id}
        </a>
      ))}
    </div>
  );
}

export function FindingsExplorer(p: {
  readonly findings: readonly ReportFindingV1[];
  readonly onSelectReceipt: (id: string) => void;
}): React.JSX.Element {
  const { findings, onSelectReceipt } = p;
  const [stateFilter, setStateFilter] = useState<FindingStateFilter>("all");
  const [sevFilter, setSevFilter] = useState<FindingSeverityFilter>("all");

  const filtered = useMemo(
    () =>
      findings.filter((f) => {
        if (stateFilter !== "all" && normalizedFindingState(f) !== stateFilter)
          return false;
        if (sevFilter !== "all" && f.severity !== sevFilter) return false;
        return true;
      }),
    [findings, sevFilter, stateFilter],
  );

  return (
    <section
      className="panel rep-section-panel"
      aria-labelledby="rep-findings-heading"
    >
      <div className="rep-section-header">
        <h2 className="rep-panel-title" id="rep-findings-heading">
          Findings{" "}
          <span className="eng-tab-count">
            {filtered.length} / {findings.length}
          </span>
        </h2>

        {findings.length === 0 ? null : (
          <div className="rep-filter-pills">
            <div
              className="rep-filter-pills"
              role="group"
              aria-label="Filter findings by state"
            >
              {FINDING_STATES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rep-chip-btn${stateFilter === opt.id ? " rep-chip-btn-active" : ""}`}
                  aria-pressed={stateFilter === opt.id}
                  onClick={() => {
                    setStateFilter(opt.id);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div
              className="rep-filter-pills"
              role="group"
              aria-label="Filter findings by severity"
            >
              {FINDING_SEVERITIES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rep-chip-btn${sevFilter === opt.id ? " rep-chip-btn-active" : ""}`}
                  aria-pressed={sevFilter === opt.id}
                  onClick={() => {
                    setSevFilter(opt.id);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {findings.length === 0 ? (
        <p className="rep-panel-sub">
          Zero findings recorded for this report run.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rep-panel-sub">No findings match the active filters.</p>
      ) : (
        <ul className="rep-cards-list">
          {filtered.map((finding, index) => {
            const state = normalizedFindingState(finding);
            return (
              <li
                key={finding.id ?? `${finding.summary}-${String(index)}`}
                className={`rep-finding-card rep-finding-${finding.severity}`}
              >
                <div className="rep-card-top">
                  <div className="eng-pill-row">
                    <SeverityBadge
                      severity={findingSeverityToOps(finding.severity)}
                    />
                    <span className="visual-pill visual-pill-neutral">
                      {state}
                    </span>
                    {finding.section === undefined ? null : (
                      <code className="rep-mailbox-chip">
                        {finding.section}
                      </code>
                    )}
                  </div>
                  <ReceiptChips
                    ids={finding.evidenceReceiptIds}
                    onSelectReceipt={onSelectReceipt}
                  />
                </div>
                <p className="rep-finding-title">{finding.summary}</p>
                {finding.detail === undefined ? null : (
                  <p className="rep-finding-detail">{finding.detail}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function ChecksBreakdown(p: {
  readonly checks: readonly ReportCheckV1[];
  readonly onSelectReceipt: (id: string) => void;
}): React.JSX.Element {
  const { checks, onSelectReceipt } = p;
  const columns = useMemo(
    (): readonly DataTableColumn<ReportCheckV1>[] => [
      {
        key: "label",
        header: "Check",
        sortValue: (check) => check.label,
        render: (check) => (
          <div className="eng-pkg-cell">
            <span className="eng-pkg-name">{check.label}</span>
            <span className="rep-cell-sub mono">{check.id}</span>
          </div>
        ),
      },
      {
        key: "required",
        header: "Requirement",
        sortValue: (check) => (check.required ? 1 : 0),
        render: (check) => (
          <span
            className={`visual-pill visual-pill-${check.required ? "info" : "neutral"}`}
          >
            {check.required ? "Required" : "Optional"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortValue: (check) => check.status,
        render: (check) => (
          <span
            className={`visual-pill visual-pill-${
              check.status === "passed"
                ? "ok"
                : check.status === "failed"
                  ? "error"
                  : "warning"
            }`}
          >
            {check.status}
          </span>
        ),
      },
      {
        key: "summary",
        header: "Summary",
        render: (check) => <p className="eng-summary-clamp">{check.summary}</p>,
      },
      {
        key: "evidence",
        header: "Receipts",
        render: (check) => (
          <ReceiptChips
            ids={check.evidenceReceiptIds}
            onSelectReceipt={onSelectReceipt}
          />
        ),
      },
    ],
    [onSelectReceipt],
  );

  return (
    <section className="rep-feed-section" aria-labelledby="rep-checks-heading">
      <h2 className="block-heading" id="rep-checks-heading">
        Checks breakdown <span className="eng-tab-count">{checks.length}</span>
      </h2>
      <DataTable
        caption="Report verification checks"
        hideCaption
        rows={checks}
        rowKey={(check) => check.id}
        rowLabel={(check) => check.label}
        columns={columns}
        initialCap={25}
        emptyMessage="No checks recorded."
      />
    </section>
  );
}
