import { ReportVerdictSchema } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import { ExternalLinkIcon, SearchIcon, XIcon } from "lucide-react";
import { useId, useMemo, useRef } from "react";
import { Link } from "react-router";

import { SeverityBadge } from "#client/ops/ops-ui.tsx";
import { age } from "#client/time.ts";
import { DataTable, type DataTableColumn } from "#client/visuals/index.ts";
import {
  ReportFeedDeliveryStatusSchema,
  type ReportFeedItem,
  type ReportsFeedQueryInput,
  type ReportsFeedTab,
} from "#shared/reports-schema";

import {
  deliveryStatusMeta,
  formatPacificShort,
  nextRovingTabIndex,
  prActionLabel,
  SEMANTIC_MAILBOXES,
  verdictLabel,
  verdictToSeverity,
} from "./reports-format.ts";

export const FEED_TABS: readonly {
  readonly id: ReportsFeedTab;
  readonly label: string;
}[] = [
  { id: "all", label: "All activity" },
  { id: "reports", label: "Scheduled reports" },
  { id: "digests", label: "Digests" },
  { id: "agent-tasks", label: "Agent tasks" },
  { id: "incidents", label: "Incident mail" },
];

const FEED_COLUMNS: readonly DataTableColumn<ReportFeedItem>[] = [
  {
    key: "when",
    header: "When",
    sortValue: (item) => item.occurredAt,
    render: (item) => (
      <div className="rep-when-cell">
        <time className="mono" dateTime={item.occurredAt}>
          {formatPacificShort(item.occurredAt)}
        </time>
        <span className="rep-cell-sub">{age(item.occurredAt)}</span>
      </div>
    ),
  },
  {
    key: "stream",
    header: "Stream & Mailbox",
    sortValue: (item) => `${item.eyebrow} ${item.mailboxTo}`,
    render: (item) => (
      <div className="eng-pkg-cell">
        <span className="rep-stream-eyebrow">{item.eyebrow}</span>
        <code className="rep-mailbox-chip">{item.mailboxTo}</code>
      </div>
    ),
  },
  {
    key: "subject",
    header: "Subject & Headline",
    sortValue: (item) => item.subject,
    render: (item) => (
      <div className="rep-subject-cell">
        <Link className="rep-feed-subject-link" to={item.href}>
          {item.subject}
        </Link>
        <p className="eng-summary-clamp rep-feed-headline">{item.headline}</p>
      </div>
    ),
  },
  {
    key: "outcome",
    header: "Outcome",
    sortValue: (item) => item.verdict,
    render: (item) => (
      <div className="rep-outcome-cell">
        <div className="eng-pill-row">
          <SeverityBadge severity={verdictToSeverity(item.verdict)} />
          <span className="rep-verdict-word">{verdictLabel(item.verdict)}</span>
        </div>
        {item.findingCount > 0 || item.failedCheckCount > 0 ? (
          <span className="rep-cell-sub mono">
            {[
              item.findingCount > 0
                ? `${String(item.findingCount)} finding${item.findingCount === 1 ? "" : "s"}`
                : null,
              item.failedCheckCount > 0
                ? `${String(item.failedCheckCount)} failed check${item.failedCheckCount === 1 ? "" : "s"}`
                : null,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    key: "delivery",
    header: "Delivery",
    sortValue: (item) => item.deliveryStatus,
    render: (item) => {
      const meta = deliveryStatusMeta(item.deliveryStatus);
      return (
        <div className="rep-delivery-cell">
          <span className={`visual-pill visual-pill-${meta.tone}`}>
            {meta.label}
          </span>
          {item.skipReason === undefined ? null : (
            <span className="rep-cell-sub mono">{item.skipReason}</span>
          )}
        </div>
      );
    },
  },
  {
    key: "action",
    header: "Action",
    render: (item) =>
      item.prUrl === undefined ? (
        <Link className="rep-inspect-link mono" to={item.href}>
          Inspect
        </Link>
      ) : (
        <a
          className="eng-ext-link"
          href={item.prUrl}
          target="_blank"
          rel="noreferrer"
        >
          {prActionLabel(item.autoMergeEnabled)}
          <ExternalLinkIcon aria-hidden="true" />
        </a>
      ),
  },
];

export function ReportsFeedSection(p: {
  readonly items: readonly ReportFeedItem[];
  readonly query: ReportsFeedQueryInput;
  readonly onUpdateQuery: (patch: Partial<ReportsFeedQueryInput>) => void;
  readonly onResetFilters: () => void;
}): React.JSX.Element {
  const { items, query, onUpdateQuery, onResetFilters } = p;
  const activeTab: ReportsFeedTab = query.tab ?? "all";
  const tabRefs = useRef(new Map<ReportsFeedTab, HTMLButtonElement>());
  const baseId = useId();
  const searchId = `${baseId}-q`;
  const mailboxId = `${baseId}-mailbox`;
  const verdictId = `${baseId}-verdict`;
  const deliveryId = `${baseId}-delivery`;

  const hasActiveFilters = useMemo(
    () =>
      query.scheduleId !== undefined ||
      query.mailbox !== undefined ||
      query.verdict !== undefined ||
      query.delivery !== undefined ||
      query.hasPr === "1" ||
      (query.q !== undefined && query.q.length > 0),
    [query],
  );

  return (
    <section
      className="rep-feed-section"
      aria-labelledby="reports-feed-heading"
    >
      <div className="rep-feed-head">
        <h2 className="block-heading" id="reports-feed-heading">
          Unified report &amp; mail history
        </h2>
        {hasActiveFilters ? (
          <button
            type="button"
            className="button rep-reset-btn"
            onClick={onResetFilters}
          >
            <XIcon aria-hidden="true" />
            <span>Reset filters</span>
          </button>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-labelledby="reports-feed-heading"
        className="eng-tablist"
      >
        {FEED_TABS.map((tab, index) => (
          <button
            key={tab.id}
            id={`reports-tab-${tab.id}`}
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
            aria-selected={tab.id === activeTab}
            tabIndex={tab.id === activeTab ? 0 : -1}
            onClick={() => {
              onUpdateQuery({ tab: tab.id });
            }}
            onKeyDown={(event) => {
              const nextIdx = nextRovingTabIndex(
                event.key,
                index,
                FEED_TABS.length,
              );
              const nextTab = nextIdx === null ? undefined : FEED_TABS[nextIdx];
              if (nextTab !== undefined) {
                event.preventDefault();
                onUpdateQuery({ tab: nextTab.id });
                tabRefs.current.get(nextTab.id)?.focus();
              }
            }}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="panel rep-feed-controls">
        <div className="rep-filter-bar">
          <div className="rep-filter-field rep-filter-search">
            <label htmlFor={searchId}>Search</label>
            <div className="search">
              <SearchIcon aria-hidden="true" />
              <input
                id={searchId}
                type="search"
                className="input"
                placeholder="Subject, headline, schedule, or mailbox…"
                value={query.q ?? ""}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  onUpdateQuery({ q: next.length === 0 ? undefined : next });
                }}
              />
            </div>
          </div>

          <div className="rep-filter-field">
            <label htmlFor={mailboxId}>Mailbox</label>
            <select
              id={mailboxId}
              value={query.mailbox ?? ""}
              onChange={(event) => {
                const val = event.currentTarget.value;
                onUpdateQuery({ mailbox: val === "" ? undefined : val });
              }}
            >
              <option value="">All mailboxes</option>
              {SEMANTIC_MAILBOXES.map((mb) => (
                <option key={mb} value={mb}>
                  {mb}
                </option>
              ))}
            </select>
          </div>

          <div className="rep-filter-field">
            <label htmlFor={verdictId}>Outcome</label>
            <select
              id={verdictId}
              value={query.verdict ?? ""}
              onChange={(event) => {
                const parsed = ReportVerdictSchema.safeParse(
                  event.currentTarget.value,
                );
                onUpdateQuery({
                  verdict: parsed.success ? parsed.data : undefined,
                });
              }}
            >
              <option value="">All outcomes</option>
              {ReportVerdictSchema.options.map((v) => (
                <option key={v} value={v}>
                  {verdictLabel(v)}
                </option>
              ))}
            </select>
          </div>

          <div className="rep-filter-field">
            <label htmlFor={deliveryId}>Delivery</label>
            <select
              id={deliveryId}
              value={query.delivery ?? ""}
              onChange={(event) => {
                const parsed = ReportFeedDeliveryStatusSchema.safeParse(
                  event.currentTarget.value,
                );
                onUpdateQuery({
                  delivery: parsed.success ? parsed.data : undefined,
                });
              }}
            >
              <option value="">All delivery states</option>
              {ReportFeedDeliveryStatusSchema.options.map((d) => (
                <option key={d} value={d}>
                  {deliveryStatusMeta(d).label}
                </option>
              ))}
            </select>
          </div>

          <div className="rep-filter-field rep-filter-toggle-wrap">
            <span className="rep-fake-field-label" aria-hidden="true">
              Remediation
            </span>
            <button
              type="button"
              className={`button rep-has-pr-btn${query.hasPr === "1" ? " rep-filter-stream-btn-on" : ""}`}
              aria-pressed={query.hasPr === "1"}
              onClick={() => {
                onUpdateQuery({
                  hasPr: query.hasPr === "1" ? undefined : "1",
                });
              }}
            >
              Has PR
            </button>
          </div>
        </div>

        {query.scheduleId === undefined ? null : (
          <div className="rep-active-schedule-banner">
            <span>
              Filtered to stream:{" "}
              <code className="rep-mailbox-chip">{query.scheduleId}</code>
            </span>
            <button
              type="button"
              className="button rep-clear-chip-btn"
              onClick={() => {
                onUpdateQuery({ scheduleId: undefined });
              }}
            >
              <XIcon aria-hidden="true" />
              <span>Clear stream</span>
            </button>
          </div>
        )}
      </div>

      <div
        role="tabpanel"
        id={`reports-panel-${activeTab}`}
        aria-labelledby={`reports-tab-${activeTab}`}
        className="rep-tabpanel"
      >
        <DataTable
          key={`${activeTab}:${query.scheduleId ?? ""}`}
          caption="Unified reports and outbound mail feed"
          hideCaption
          rows={items}
          rowKey={(item) => `${item.kind}:${item.id}`}
          rowLabel={(item) => item.subject}
          columns={FEED_COLUMNS}
          initialCap={10}
          exportFilename="hub-reports-feed"
          emptyMessage="No report runs, digests, or incident emails match these filters."
        />
      </div>
    </section>
  );
}
