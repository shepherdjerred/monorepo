import { type ReactElement } from "react";
import { sortedTimeline, type TimelineItem } from "#lib/fold";
import { describe } from "./format.ts";

function clockTime(epoch: number): string {
  if (epoch === 0) {
    return "--:--:--";
  }
  return new Date(epoch).toLocaleTimeString([], { hour12: false });
}

function hasBody(body: unknown): boolean {
  return body !== undefined && body !== null;
}

function Row({ item }: { item: TimelineItem }): ReactElement {
  const d = describe(item);
  return (
    <div className={`row row-${d.category}`}>
      <span className="row-time">{clockTime(item.t)}</span>
      <span className="row-icon">{d.icon}</span>
      <div className="row-main">
        <div className="row-title">
          <span className="row-titletext">{d.title}</span>
          {d.meta !== undefined && d.meta !== "" ? (
            <span className="row-meta">{d.meta}</span>
          ) : null}
        </div>
        {d.text !== undefined && d.text !== "" ? (
          <pre className="row-text">{d.text}</pre>
        ) : null}
        {hasBody(d.body) ? (
          <details className="row-body">
            <summary>details</summary>
            <pre>{JSON.stringify(d.body, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

export function Transcript({
  items,
}: {
  items: readonly TimelineItem[];
}): ReactElement {
  const ordered = sortedTimeline(items);
  if (ordered.length === 0) {
    return <p className="empty">No activity yet.</p>;
  }
  return (
    <div className="transcript">
      {ordered.map((item) => (
        <Row key={item.order} item={item} />
      ))}
    </div>
  );
}
