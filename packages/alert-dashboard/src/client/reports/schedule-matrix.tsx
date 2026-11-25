import { ExternalLinkIcon, FilterIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";

import { age } from "#client/time.ts";
import type { ScheduleOverviewItem } from "#shared/reports-schema";

import {
  automationModeMeta,
  dayCellLabel,
  deliveryStatusMeta,
  formatPacificShort,
  freshnessMeta,
  prActionLabel,
  SCHEDULE_MAILBOXES,
  verdictLabel,
  type PillTone,
} from "./reports-format.ts";

function Pill({
  tone,
  children,
}: {
  readonly tone: PillTone;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <span className={`visual-pill visual-pill-${tone}`}>{children}</span>;
}

function ScheduleDayStrip({
  schedule,
}: {
  readonly schedule: ScheduleOverviewItem;
}): React.JSX.Element {
  return (
    <div
      className="rep-day-strip"
      role="group"
      aria-label={`${schedule.title} 30-day Pacific activity`}
    >
      {schedule.days.map((cell) => {
        const label = dayCellLabel(cell);
        return (
          <span
            key={cell.date}
            role="img"
            aria-label={label}
            title={label}
            className={`rep-day rep-day-${cell.state}`}
          />
        );
      })}
    </div>
  );
}

function ScheduleMatrixRow(p: {
  readonly schedule: ScheduleOverviewItem;
  readonly activeScheduleId: string | undefined;
  readonly onToggleSchedule: (scheduleId: string) => void;
}): React.JSX.Element {
  const { schedule, activeScheduleId, onToggleSchedule } = p;
  const mode = automationModeMeta(schedule.automationMode);
  const freshness = freshnessMeta(schedule.freshness);
  const latest = schedule.latestRun;
  const isFiltered = activeScheduleId === schedule.scheduleId;

  return (
    <li
      className={`rep-schedule-row${isFiltered ? " rep-schedule-row-active" : ""}`}
    >
      <div className="rep-schedule-ident">
        <div className="rep-schedule-title-line">
          <strong className="rep-schedule-title">{schedule.title}</strong>
          <span className="rep-schedule-cron mono">{schedule.cronLabel}</span>
        </div>
        <div className="eng-pill-row">
          <code className="rep-mailbox-chip">{schedule.mailbox.to}</code>
          <Pill tone={mode.tone}>{mode.label}</Pill>
          <Pill tone={freshness.tone}>{freshness.label}</Pill>
        </div>
      </div>

      <div className="rep-schedule-activity">
        <ScheduleDayStrip schedule={schedule} />
      </div>

      <div className="rep-schedule-latest">
        {latest === null ? (
          <span className="rep-schedule-empty">No runs recorded yet</span>
        ) : (
          <div className="rep-latest-stack">
            <Link className="rep-latest-link" to={latest.runHref}>
              {latest.subject}
            </Link>
            <div className="eng-pill-row rep-latest-meta">
              <time
                className="mono"
                dateTime={latest.completedAt}
                title={formatPacificShort(latest.completedAt)}
              >
                {age(latest.completedAt)} ·{" "}
                {formatPacificShort(latest.completedAt)}
              </time>
              <Pill tone={deliveryStatusMeta(latest.deliveryStatus).tone}>
                {deliveryStatusMeta(latest.deliveryStatus).label}
              </Pill>
              <Pill
                tone={
                  latest.verdict === "attention"
                    ? "warning"
                    : latest.verdict === "changed"
                      ? "info"
                      : latest.verdict === "clear"
                        ? "ok"
                        : "neutral"
                }
              >
                {verdictLabel(latest.verdict)}
              </Pill>
              {latest.prUrl === undefined ? null : (
                <a
                  className="eng-ext-link"
                  href={latest.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {prActionLabel(latest.autoMergeEnabled)}
                  <ExternalLinkIcon aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          className={`button rep-filter-stream-btn${isFiltered ? " rep-filter-stream-btn-on" : ""}`}
          aria-pressed={isFiltered}
          aria-label={`Filter feed by ${schedule.title}`}
          onClick={() => {
            onToggleSchedule(schedule.scheduleId);
          }}
        >
          <FilterIcon aria-hidden="true" />
          <span>{isFiltered ? "Filtered" : "Filter"}</span>
        </button>
      </div>
    </li>
  );
}

const SCHEDULE_MAILBOX_SET: ReadonlySet<string> = new Set(SCHEDULE_MAILBOXES);

export function ScheduleMatrix(p: {
  readonly schedules: readonly ScheduleOverviewItem[];
  readonly selectedMailbox: string | undefined;
  readonly selectedScheduleId: string | undefined;
  readonly onSelectMailbox: (mailbox: string | undefined) => void;
  readonly onToggleSchedule: (scheduleId: string) => void;
}): React.JSX.Element {
  const {
    schedules,
    selectedMailbox,
    selectedScheduleId,
    onSelectMailbox,
    onToggleSchedule,
  } = p;

  const countsByMailbox = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of schedules) {
      map.set(item.mailbox.to, (map.get(item.mailbox.to) ?? 0) + 1);
    }
    return map;
  }, [schedules]);

  const allSelected =
    selectedMailbox === undefined || !SCHEDULE_MAILBOX_SET.has(selectedMailbox);

  const visibleSchedules = useMemo(
    () =>
      allSelected
        ? schedules
        : schedules.filter((item) => item.mailbox.to === selectedMailbox),
    [allSelected, schedules, selectedMailbox],
  );

  return (
    <section
      className="panel rep-matrix-panel"
      aria-label="Recurring report schedules"
    >
      <header className="rep-matrix-header">
        <div>
          <h2 className="rep-panel-title">
            Recurring report schedules{" "}
            <span className="eng-tab-count">{visibleSchedules.length}</span>
          </h2>
          <p className="rep-panel-sub">
            {schedules.length} scheduled Temporal report &amp; Ops digest
            streams across 30 Pacific days
          </p>
        </div>

        <p className="rep-legend">
          <span>30d PT:</span>
          <span>
            <i className="rep-day rep-day-clear" aria-hidden="true" /> Clear
          </span>
          <span>
            <i className="rep-day rep-day-quiet-clear" aria-hidden="true" />{" "}
            Quiet in Hub
          </span>
          <span>
            <i className="rep-day rep-day-changed" aria-hidden="true" /> Changed
            / PR
          </span>
          <span>
            <i className="rep-day rep-day-attention" aria-hidden="true" /> Needs
            review
          </span>
          <span>
            <i className="rep-day rep-day-failed" aria-hidden="true" /> Failed
          </span>
          <span>
            <i className="rep-day rep-day-none" aria-hidden="true" /> None
          </span>
        </p>
      </header>

      <div
        className="rep-mailbox-pills"
        role="group"
        aria-label="Filter schedules by semantic mailbox"
      >
        <button
          type="button"
          className={`rep-chip-btn${allSelected ? " rep-chip-btn-active" : ""}`}
          aria-pressed={allSelected}
          onClick={() => {
            onSelectMailbox(undefined);
          }}
        >
          <span>All mailboxes</span>
          <span className="eng-tab-count">{schedules.length}</span>
        </button>
        {SCHEDULE_MAILBOXES.map((mailbox) => {
          const active = selectedMailbox === mailbox;
          return (
            <button
              key={mailbox}
              type="button"
              className={`rep-chip-btn mono${active ? " rep-chip-btn-active" : ""}`}
              aria-pressed={active}
              onClick={() => {
                onSelectMailbox(active ? undefined : mailbox);
              }}
            >
              <span>{mailbox}</span>
              <span className="eng-tab-count">
                {countsByMailbox.get(mailbox) ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="rep-schedule-list">
        {visibleSchedules.map((schedule) => (
          <ScheduleMatrixRow
            key={schedule.scheduleId}
            schedule={schedule}
            activeScheduleId={selectedScheduleId}
            onToggleSchedule={onToggleSchedule}
          />
        ))}
      </ul>
    </section>
  );
}
