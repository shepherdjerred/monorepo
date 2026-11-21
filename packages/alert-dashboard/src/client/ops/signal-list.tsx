import {
  groupSignals,
  type SignalGroup,
} from "@shepherdjerred/ops-model/signals/signal-groups.ts";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from "lucide-react";
import { useId, useState } from "react";

import { ExternalLink, ServiceLink, SeverityBadge } from "./ops-ui.tsx";
import { age } from "#client/time.ts";

/** Entries a list shows before the rest sit behind "Show N more". */
const DEFAULT_CAP = 10;
/** Member rows an opened group shows before its own "Show N more". */
const GROUP_MEMBER_CAP = 25;
/** An overflow this small is shown outright; a toggle would hide less than it costs. */
const CAP_SLACK = 2;

type Capped<T> = {
  readonly shown: readonly T[];
  /** Items the cap is holding back while collapsed. */
  readonly hidden: number;
  /** Whether the list is long enough to need the toggle at all. */
  readonly capped: boolean;
  readonly expanded: boolean;
  readonly toggle: () => void;
};

function useCapped<T>(items: readonly T[], cap: number): Capped<T> {
  const [expanded, setExpanded] = useState(false);
  const capped = items.length > cap + CAP_SLACK;
  return {
    shown: capped && !expanded ? items.slice(0, cap) : items,
    hidden: capped ? items.length - cap : 0,
    capped,
    expanded,
    toggle: () => {
      setExpanded((value) => !value);
    },
  };
}

function ListToggle({
  list,
  controls,
}: {
  readonly list: Capped<unknown>;
  readonly controls: string;
}): React.JSX.Element | null {
  if (!list.capped) return null;
  const Icon = list.expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      className="list-toggle"
      aria-expanded={list.expanded}
      aria-controls={controls}
      onClick={list.toggle}
    >
      {list.expanded ? "Show fewer" : `Show ${String(list.hidden)} more`}
      <Icon aria-hidden="true" />
    </button>
  );
}

function SignalItem({
  signal,
  isNew,
  showService,
}: {
  readonly signal: Signal;
  readonly isNew: boolean;
  readonly showService: boolean;
}): React.JSX.Element {
  const [primary, ...rest] = signal.links;
  return (
    <li className="signal">
      <SeverityBadge severity={signal.severity} />
      <div className="signal-body">
        <p className="signal-title">
          {primary === undefined ? (
            signal.title
          ) : (
            <a href={primary.url} target="_blank" rel="noreferrer">
              {signal.title}
            </a>
          )}
          {isNew ? <span className="new-tag">New</span> : null}
        </p>
        {signal.detail === undefined ? null : (
          <p className="signal-detail">{signal.detail}</p>
        )}
        <div className="signal-meta">
          {showService && signal.service !== undefined ? (
            <ServiceLink id={signal.service} />
          ) : null}
          {signal.since === undefined ? null : (
            <span className="mono">since {age(signal.since)}</span>
          )}
          {rest.map((link) => (
            <ExternalLink className="chip" key={link.url} link={link} />
          ))}
        </div>
      </div>
    </li>
  );
}

function GroupMembers({
  group,
  newIds,
  showService,
}: {
  readonly group: SignalGroup;
  readonly newIds: ReadonlySet<string> | undefined;
  readonly showService: boolean;
}): React.JSX.Element {
  const listId = useId();
  const members = useCapped(group.signals, GROUP_MEMBER_CAP);
  return (
    <div className="signal-group-members">
      <ul className="signal-list" id={listId} aria-label={group.label}>
        {members.shown.map((signal) => (
          <SignalItem
            key={signal.id}
            signal={signal}
            isNew={newIds?.has(signal.id) ?? false}
            showService={showService}
          />
        ))}
      </ul>
      <ListToggle list={members} controls={listId} />
    </div>
  );
}

/**
 * Same-kind signals collapsed into one row. The member rows mount only while
 * the disclosure is open, so a hundred Renovate approvals cost one row.
 */
function SignalGroupItem({
  group,
  newIds,
  showService,
}: {
  readonly group: SignalGroup;
  readonly newIds: ReadonlySet<string> | undefined;
  readonly showService: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const newCount =
    newIds === undefined
      ? 0
      : group.signals.filter((signal) => newIds.has(signal.id)).length;
  return (
    <li className="signal-group">
      <details
        open={open}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
        }}
      >
        <summary>
          <SeverityBadge severity={group.severity} />
          <span className="signal-body">
            <span className="signal-title">
              {group.label}
              {newCount === 0 ? null : (
                <span className="new-tag">{newCount} new</span>
              )}
            </span>
            {group.since === undefined ? null : (
              <span className="signal-meta">
                <span className="mono">oldest {age(group.since)}</span>
              </span>
            )}
          </span>
          <ChevronRightIcon
            className="signal-group-marker"
            aria-hidden="true"
          />
        </summary>
        {open ? (
          <GroupMembers
            group={group}
            newIds={newIds}
            showService={showService}
          />
        ) : null}
      </details>
    </li>
  );
}

/**
 * Every list of signals in Hub. Same-kind signals collapse into group rows
 * first, then the list shows at most `cap` entries with the rest one click
 * away, so no list grows with the number of signals behind it.
 */
export function SignalList({
  signals,
  empty,
  newIds,
  showService = true,
  cap = DEFAULT_CAP,
}: {
  readonly signals: readonly Signal[];
  readonly empty: string;
  readonly newIds?: ReadonlySet<string>;
  readonly showService?: boolean;
  readonly cap?: number;
}): React.JSX.Element {
  const listId = useId();
  const entries = useCapped(groupSignals(signals), cap);
  if (signals.length === 0) return <p className="list-empty">{empty}</p>;
  return (
    <>
      <ul className="signal-list" id={listId}>
        {entries.shown.map((entry) =>
          entry.type === "signal" ? (
            <SignalItem
              key={entry.signal.id}
              signal={entry.signal}
              isNew={newIds?.has(entry.signal.id) ?? false}
              showService={showService}
            />
          ) : (
            <SignalGroupItem
              key={entry.id}
              group={entry}
              newIds={newIds}
              showService={showService}
            />
          ),
        )}
      </ul>
      <ListToggle list={entries} controls={listId} />
    </>
  );
}
