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

/** Kinds that wait on someone rather than report a failure. */
const WAITS: ReadonlySet<Attention["kind"]> = new Set(["approval", "queued"]);

/**
 * What someone has to act on, newest first. Renders nothing when there is
 * nothing to act on. A failure, a recovery or an alarm outranks a wait, so
 * the panel takes the failure tone as soon as it holds one.
 */
export function AttentionPanel({ items }: { items: Attention[] }) {
  if (items.length === 0) return null;
  const waiting = items.every((item) => WAITS.has(item.kind));
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
      <ul>
        {items.map((item) => (
          <li key={`${item.kind}:${item.target.id}`}>
            <span className={`badge badge-${item.kind}`}>
              {ATTENTION[item.kind]}
            </span>
            <TargetLink target={item.target}>{item.title}</TargetLink>
            <span className="muted">{item.detail}</span>
            {item.at !== null && <RelativeTime value={item.at} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
