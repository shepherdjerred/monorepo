import {
  StatusGlyph,
  cappedCount,
  useCapped,
} from "@shepherdjerred/console-ui";
import {
  severityRank,
  type Severity,
} from "@shepherdjerred/ops-model/severity.ts";
import {
  groupSignals,
  type SignalEntry,
  type SignalGroup,
} from "@shepherdjerred/ops-model/signals/signal-groups.ts";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { signalUsedRatio } from "./ai-quota.ts";
import { ListToggle } from "./capped-list.tsx";
import { ExternalLink, ServiceLink } from "./ops-ui.tsx";
import { bucketBySeverity } from "#client/severity-buckets.ts";
import { age } from "#client/time.ts";
import { formatValue } from "#shared/ops-format";

/** Entries a list shows before the rest sit behind "Show N more". */
const DEFAULT_CAP = 10;
/** Member rows an opened group shows before its own "Show N more". */
const GROUP_MEMBER_CAP = 25;

/** What the second column names: the snapshot area, the service, or nothing. */
type Placement = {
  readonly header: string;
  readonly render: (signal: Signal) => ReactNode;
} | null;

type Columns = {
  readonly placement: Placement;
  /** Whether any shown signal reports a used ratio (quota windows). */
  readonly used: boolean;
};

function columnCount(columns: Columns): number {
  return 2 + (columns.placement === null ? 0 : 1) + (columns.used ? 1 : 0);
}

/** A quota window's usage as console-ui's inline meter; nothing otherwise. */
function UsedMeter({
  signal,
}: {
  readonly signal: Signal;
}): React.JSX.Element | null {
  const ratio = signalUsedRatio(signal);
  if (ratio === undefined) return null;
  const percent = Math.min(ratio, 1) * 100;
  return (
    <span
      className="ui-meter"
      data-sev={signal.severity}
      role="meter"
      aria-label={`${signal.title} used`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <span className="ui-meter-track" aria-hidden="true">
        <span
          className="ui-meter-fill"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
      <span className="ui-meter-text" aria-hidden="true">
        {formatValue(ratio, "ratio")}
      </span>
    </span>
  );
}

/**
 * One signal as a row: its glyph (the severity heading row above carries the
 * word, and the glyph keeps it for assistive technology), the title, an
 * unread dot when it is new, its detail and extra links, then where it
 * belongs and how long it has lasted.
 */
function SignalRow({
  signal,
  isNew,
  columns,
  memberOf,
}: {
  readonly signal: Signal;
  readonly isNew: boolean;
  readonly columns: Columns;
  /** The group row this signal sits under, when it is a group member. */
  readonly memberOf?: string;
}): React.JSX.Element {
  const [primary, ...rest] = signal.links;
  return (
    <tr
      className={memberOf === undefined ? "signal" : "signal ui-table-child"}
      data-sev={signal.severity}
      {...(memberOf === undefined
        ? { "data-entry": "" }
        : { "data-member-of": memberOf })}
    >
      <th scope="row" className="ui-lead signal-cell">
        {isNew ? (
          <span className="ui-unread">
            <span className="ui-sr-only">New: </span>
          </span>
        ) : null}
        <span className="signal-line">
          <StatusGlyph severity={signal.severity} hideLabel />
          <span className="signal-title">
            {primary === undefined ? (
              signal.title
            ) : (
              <a href={primary.url} target="_blank" rel="noreferrer">
                {signal.title}
              </a>
            )}
          </span>
        </span>
        {signal.detail === undefined ? null : (
          <span className="signal-detail">{signal.detail}</span>
        )}
        {/* At narrow widths the place and usage columns fold in here; each
            width shows exactly one of the two copies. */}
        {columns.placement === null && !columns.used ? null : (
          <span className="signal-inline">
            {columns.placement?.render(signal)}
            {columns.used ? <UsedMeter signal={signal} /> : null}
          </span>
        )}
        {rest.length === 0 ? null : (
          <span className="signal-meta">
            {rest.map((link) => (
              <ExternalLink className="chip" key={link.url} link={link} />
            ))}
          </span>
        )}
      </th>
      {columns.placement === null ? null : (
        <td className="signal-place">{columns.placement.render(signal)}</td>
      )}
      {columns.used ? (
        <td className="num signal-used">
          <UsedMeter signal={signal} />
        </td>
      ) : null}
      <td className="num signal-since">
        {signal.since === undefined ? null : (
          <time dateTime={signal.since}>{age(signal.since)}</time>
        )}
      </td>
    </tr>
  );
}

/**
 * Same-kind signals collapsed into one row whose title is the disclosure
 * button. The member rows mount only while it is open, so a hundred Renovate
 * approvals cost one row.
 */
function GroupRows({
  group,
  newIds,
  columns,
  tableId,
}: {
  readonly group: SignalGroup;
  readonly newIds: ReadonlySet<string> | undefined;
  readonly columns: Columns;
  readonly tableId: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const members = useCapped(group.signals, GROUP_MEMBER_CAP);
  const newCount =
    newIds === undefined
      ? 0
      : group.signals.filter((signal) => newIds.has(signal.id)).length;
  return (
    <>
      <tr
        className="signal-group"
        data-sev={group.severity}
        data-group={group.id}
        data-entry=""
      >
        <th scope="row" className="ui-lead signal-cell">
          {newCount === 0 ? null : <span className="ui-unread" />}
          <span className="signal-line">
            <StatusGlyph severity={group.severity} hideLabel />
            <button
              type="button"
              className="signal-group-toggle"
              aria-expanded={open}
              onClick={() => {
                setOpen((value) => !value);
              }}
            >
              <ChevronRightIcon
                className="signal-group-marker"
                aria-hidden="true"
              />
              {group.label}
              {newCount === 0 ? null : (
                <span className="new-count">{newCount} new</span>
              )}
            </button>
          </span>
        </th>
        {columns.placement === null ? null : <td className="signal-place" />}
        {columns.used ? <td className="num signal-used" /> : null}
        <td className="num signal-since">
          {group.since === undefined ? null : (
            <time dateTime={group.since}>oldest {age(group.since)}</time>
          )}
        </td>
      </tr>
      {open
        ? members.shown.map((signal) => (
            <SignalRow
              key={signal.id}
              signal={signal}
              isNew={newIds?.has(signal.id) ?? false}
              columns={columns}
              memberOf={group.id}
            />
          ))
        : null}
      {open && members.capped ? (
        <tr className="ui-table-child" data-member-of={group.id}>
          <td colSpan={columnCount(columns)}>
            <ListToggle list={members} controls={tableId} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function entrySeverity(entry: SignalEntry): Severity {
  return entry.type === "signal" ? entry.signal.severity : entry.severity;
}

/** The shown entries in one bucket per severity, worst first. */
function bySeverity(
  entries: readonly SignalEntry[],
): [Severity, SignalEntry[]][] {
  return bucketBySeverity(entries, entrySeverity, severityRank);
}

function signalCount(entries: readonly SignalEntry[]): number {
  return entries.reduce(
    (sum, entry) => sum + (entry.type === "signal" ? 1 : entry.count),
    0,
  );
}

/** Characters of a title, and of a detail, that fit one line of a half-width panel. */
const TITLE_LINE_CHARS = 36;
const DETAIL_LINE_CHARS = 52;

function textLines(text: string, lineChars: number): number {
  return Math.max(1, Math.ceil(text.length / lineChars));
}

/** The lines of text a row gives an entry, plus its padding. */
function entryLines(entry: SignalEntry): number {
  if (entry.type === "group")
    return 1 + textLines(entry.label, TITLE_LINE_CHARS);
  const { title, detail, links } = entry.signal;
  return (
    1 +
    textLines(title, TITLE_LINE_CHARS) +
    (detail === undefined ? 0 : textLines(detail, DETAIL_LINE_CHARS)) +
    (links.length > 1 ? 1 : 0)
  );
}

/**
 * About how tall a collapsed `SignalList` of these signals is, in lines of
 * text. It is an estimate for laying panels out before they render, such as
 * balancing two columns; nothing else should depend on it.
 */
export function estimatedListLines(
  signals: readonly Signal[],
  cap: number = DEFAULT_CAP,
): number {
  const entries = groupSignals(signals);
  if (entries.length === 0) return 1;
  const shown = entries.slice(0, cappedCount(entries.length, cap));
  const headings = 1 + bySeverity(shown).length;
  const toggle = shown.length < entries.length ? 2 : 0;
  return shown.reduce(
    (lines, entry) => lines + entryLines(entry),
    headings + toggle,
  );
}

/**
 * Every list of signals in Hub, as one table. Same-kind signals collapse into
 * group rows first, then the table shows at most `cap` entries with the rest
 * one click away, so no list grows with the number of signals behind it. The
 * shown entries sit under one heading row per severity ("Error 3").
 */
export function SignalList({
  signals,
  empty,
  label = "Signals",
  newIds,
  showService = true,
  area,
  cap = DEFAULT_CAP,
}: {
  readonly signals: readonly Signal[];
  readonly empty: string;
  /** The table's accessible name. */
  readonly label?: string;
  readonly newIds?: ReadonlySet<string>;
  readonly showService?: boolean;
  /** Names the area a signal belongs to; replaces the service column. */
  readonly area?: (signal: Signal) => string;
  readonly cap?: number;
}): React.JSX.Element {
  const tableId = useId();
  const entries = useCapped(groupSignals(signals), cap);
  if (signals.length === 0) return <p className="list-empty">{empty}</p>;
  const placement: Placement =
    area === undefined
      ? showService
        ? {
            header: "Service",
            render: (signal) =>
              signal.service === undefined ? null : (
                <ServiceLink id={signal.service} />
              ),
          }
        : null
      : { header: "Area", render: area };
  const columns: Columns = {
    placement,
    used: entries.shown.some(
      (entry) =>
        entry.type === "signal" && signalUsedRatio(entry.signal) !== undefined,
    ),
  };
  return (
    <>
      <div className="ui-table-scroll signal-scroll">
        <table className="ui-table signal-list" id={tableId} aria-label={label}>
          <thead>
            <tr>
              <th scope="col">Signal</th>
              {placement === null ? null : (
                <th scope="col" className="signal-place">
                  {placement.header}
                </th>
              )}
              {columns.used ? (
                <th scope="col" className="num signal-used">
                  Used
                </th>
              ) : null}
              <th scope="col" className="num">
                Since
              </th>
            </tr>
          </thead>
          {bySeverity(entries.shown).map(([severity, bucket]) => (
            <tbody key={severity} data-sev={severity}>
              <tr className="ui-table-group">
                <th scope="rowgroup" colSpan={columnCount(columns)}>
                  <StatusGlyph severity={severity} />
                  <span className="ui-count">{signalCount(bucket)}</span>
                </th>
              </tr>
              {bucket.map((entry) =>
                entry.type === "signal" ? (
                  <SignalRow
                    key={entry.signal.id}
                    signal={entry.signal}
                    isNew={newIds?.has(entry.signal.id) ?? false}
                    columns={columns}
                  />
                ) : (
                  <GroupRows
                    key={entry.id}
                    group={entry}
                    newIds={newIds}
                    columns={columns}
                    tableId={tableId}
                  />
                ),
              )}
            </tbody>
          ))}
        </table>
      </div>
      <ListToggle list={entries} controls={tableId} />
    </>
  );
}
