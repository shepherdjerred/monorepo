import { useId, type ReactNode } from "react";
import { FailureNotice } from "@shepherdjerred/streambot/web/client/failure-notice.tsx";
import { MediaCard } from "./media-card.tsx";
import { MediaRow, SkeletonRows } from "./media-row.tsx";
import type { MediaItem } from "./row-model.ts";
import type { Load } from "@shepherdjerred/streambot/web/client/use-load.ts";
import "@shepherdjerred/streambot/web/client/styles/home.css";

/**
 * A titled list of media from one request: skeleton rows while it loads, its specific error with
 * Retry, a quiet note when it is empty, and otherwise rows (or poster cards).
 */
export function ItemSection<T>(props: {
  title: string;
  load: Load<T>;
  items: (data: T) => readonly MediaItem[];
  onRetry: () => void;
  empty: string;
  layout?: "rows" | "cards";
  /** Shown beside the heading, such as a "See all" link. */
  aside?: ReactNode;
  headingLevel?: "h1" | "h2";
}) {
  const headingId = useId();
  const Heading = props.headingLevel ?? "h2";
  const { load } = props;
  const items = load.status === "done" ? props.items(load.data) : [];
  return (
    <section
      className="section"
      aria-labelledby={headingId}
      aria-busy={load.status === "loading"}
      data-row-scope="section"
    >
      <div className="section-head">
        <Heading
          id={headingId}
          className={Heading === "h1" ? "page-heading" : "section-heading"}
          tabIndex={Heading === "h1" ? -1 : undefined}
        >
          {props.title}
        </Heading>
        {props.aside}
      </div>
      {load.status === "loading" && (
        <ul className="rows">
          <SkeletonRows count={3} />
        </ul>
      )}
      {load.status === "failed" && (
        <p className="status">
          <FailureNotice failure={load.failure} onRetry={props.onRetry} />
        </p>
      )}
      {load.status === "done" && items.length === 0 && (
        <p className="empty-note">{props.empty}</p>
      )}
      {items.length > 0 &&
        (props.layout === "cards" ? (
          <ul className="cards">
            {items.map((item) => (
              <MediaCard key={item.key} item={item} />
            ))}
          </ul>
        ) : (
          <ul className="rows">
            {items.map((item) => (
              <MediaRow key={item.key} item={item} />
            ))}
          </ul>
        ))}
    </section>
  );
}
