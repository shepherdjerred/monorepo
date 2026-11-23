import { useId, useState } from "react";
import type { Attention } from "#shared/hub/hub-contract.ts";
import { TargetLink } from "./links.tsx";
import { RelativeTime } from "./time.tsx";

const ATTENTION: Record<Attention["kind"], string> = {
  approval: "Approval",
  failed: "Failed",
  recovery: "Recovery",
  alarm: "Alarm",
  queued: "Queued",
  build_failed: "Build",
};

/** How many items every page shows before the rest wait behind "Show all". */
export const ATTENTION_COLLAPSE_AFTER = 5;

/** Kinds that wait on someone rather than report a failure. */
const WAITS: ReadonlySet<Attention["kind"]> = new Set(["approval", "queued"]);

/**
 * What someone has to act on, newest first. Renders nothing when there is
 * nothing to act on. A failure, a recovery or an alarm outranks a wait, so
 * the panel takes the failure tone as soon as it holds one. Each row keeps
 * its kind, its lead, its summary and its time in fixed columns, so rows read
 * alike however long their words. `collapseAfter` shows only that many
 * items, with a button for the rest, on a page where the list is not the
 * point.
 */
export function AttentionPanel({
  items,
  collapseAfter,
}: {
  items: Attention[];
  collapseAfter?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = useId();
  if (items.length === 0) return null;
  const waiting = items.every((item) => WAITS.has(item.kind));
  const collapsible =
    collapseAfter !== undefined && items.length > collapseAfter;
  const shown =
    collapsible && !expanded ? items.slice(0, collapseAfter) : items;
  return (
    <section
      className={`panel attention ${waiting ? "attention-waiting" : "attention-failed"}`}
      aria-labelledby="attention-heading"
    >
      <div className="section-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <span className="attention-count">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <ul id={list}>
        {shown.map((item) => (
          <li key={`${item.kind}:${item.target.id}`}>
            <span className={`badge badge-${item.kind}`}>
              {ATTENTION[item.kind]}
            </span>
            <span className="attention-lead">
              <TargetLink target={item.target}>{item.title}</TargetLink>
            </span>
            <span className="muted attention-summary">{item.detail}</span>
            {item.at !== null && (
              <span className="attention-when">
                <RelativeTime value={item.at} />
              </span>
            )}
          </li>
        ))}
      </ul>
      {collapsible && (
        <button
          type="button"
          className="secondary-button attention-toggle"
          aria-expanded={expanded}
          aria-controls={list}
          onClick={() => {
            setExpanded(!expanded);
          }}
        >
          {expanded ? "Show fewer" : `Show all ${String(items.length)}`}
        </button>
      )}
    </section>
  );
}
