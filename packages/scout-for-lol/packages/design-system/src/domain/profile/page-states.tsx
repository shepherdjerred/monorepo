import { CircleAlert, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { cn } from "#src/lib/cn.ts";

export type PageStateKind = "empty" | "not-found" | "unavailable";

export type PageStateProps = {
  kind: PageStateKind;
  /** The heading: the section, or the page. */
  title: string;
  /** One friendly sentence: "No games yet". */
  lead: string;
  /** A fact that helps, never an explanation of the page. */
  detail?: string;
  /** What to do next: chips or links. */
  actions?: ReactNode;
  /** The element level of `title`. */
  level?: 1 | 2 | 3;
  id: string;
  className?: string;
};

/**
 * What a page shows when there is nothing to show, nothing found, or nothing
 * available: a panel with a heading, one sentence and what to do. Not found
 * and unavailable carry a quiet icon; empty does not, because empty is not a
 * fault.
 */
export function PageState({
  kind,
  title,
  lead,
  detail,
  actions,
  level = 2,
  id,
  className,
}: PageStateProps) {
  const Heading = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  return (
    <Panel asChild className={cn("scout-page-state", className)}>
      <section aria-labelledby={id} data-kind={kind}>
        {kind === "empty" ? null : (
          <span className="scout-page-state__icon" aria-hidden="true">
            {kind === "not-found" ? (
              <SearchX size={22} />
            ) : (
              <CircleAlert size={22} />
            )}
          </span>
        )}
        <Heading id={id} className="scout-page-state__title">
          {title}
        </Heading>
        <p className="scout-page-state__lead">{lead}</p>
        {detail === undefined ? null : (
          <p className="scout-page-state__detail">{detail}</p>
        )}
        {actions === undefined ? null : (
          <div className="scout-page-state__actions">{actions}</div>
        )}
      </section>
    </Panel>
  );
}

export type PageLoadingProps = {
  /** "panel": a heading and lines. "list": rows with a face and two lines. */
  shape?: "panel" | "list";
  /** How many rows a list shows. */
  rows?: number;
  /** Read aloud while the page loads. */
  label?: string;
  className?: string;
};

/**
 * Soft placeholders in the shape of the page, announced as busy. The pulse
 * stops under `prefers-reduced-motion`.
 */
export function PageLoading({
  shape = "panel",
  rows = 4,
  label = "Loading",
  className,
}: PageLoadingProps) {
  return (
    <Panel
      className={cn("scout-page-loading", className)}
      role="status"
      aria-busy="true"
      data-shape={shape}
    >
      <span className="scout-sr-only">{label}</span>
      <span
        className="scout-page-loading__bar"
        data-part="title"
        aria-hidden="true"
      />
      {shape === "panel" ? (
        <>
          <span
            className="scout-page-loading__bar"
            data-part="lead"
            aria-hidden="true"
          />
          <span
            className="scout-page-loading__bar"
            data-part="line"
            aria-hidden="true"
          />
          <span
            className="scout-page-loading__bar"
            data-part="block"
            aria-hidden="true"
          />
        </>
      ) : (
        <span className="scout-page-loading__rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, index) => (
            <span
              key={`row-${String(index)}`}
              className="scout-page-loading__row"
            >
              <span className="scout-page-loading__bar" data-part="face" />
              <span className="scout-page-loading__bar" data-part="line" />
            </span>
          ))}
        </span>
      )}
    </Panel>
  );
}
