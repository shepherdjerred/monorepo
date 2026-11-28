import { MessageCircleIcon, PanelRightCloseIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useWaiters } from "#client/data/queries.ts";
import { useShortcuts } from "./shortcuts.ts";
import type { PanelState } from "./panel-state.ts";

/**
 * The comments as a floating card over the right of the canvas or viewer
 * (a bottom sheet on a narrow screen), collapsible to a small pill with the
 * `MessageCircle` icon, the open-thread count and a dot while an agent waits.
 * Shift+C toggles it. Expanding moves focus into the card and collapsing moves
 * it back to the toggle; there is no animation, so nothing to reduce.
 */
export function CommentsPanel({
  state,
  scope,
  openCount,
  children,
}: {
  readonly state: PanelState;
  readonly scope: { readonly board: string } | { readonly artifactId: string };
  readonly openCount: number;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const id = useId();
  const waiters = useWaiters(scope);
  const waiting = (waiters.data?.waiters.length ?? 0) > 0;
  const cardRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  const { collapsed, toggle } = state;

  useShortcuts([{ key: "c", shift: true, run: toggle }]);

  // After the first render, a change of state moves focus with it.
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    if (collapsed) toggleRef.current?.focus();
    else cardRef.current?.focus();
  }, [collapsed]);

  const summary = `${String(openCount)} open${waiting ? ", an agent is waiting" : ""}`;
  if (collapsed)
    return (
      <button
        ref={toggleRef}
        type="button"
        className="ar-panel-pill"
        aria-expanded={false}
        aria-controls={id}
        aria-keyshortcuts="Shift+C"
        title="Show comments (Shift+C)"
        data-testid="panel-toggle"
        onClick={toggle}
      >
        <MessageCircleIcon aria-hidden="true" size={20} strokeWidth={1.5} />
        <span className="ar-panel-count">{openCount}</span>
        {waiting ? (
          <span className="ar-dot ar-panel-dot" aria-hidden="true" />
        ) : null}
        <span className="ui-sr-only">Show comments, {summary}</span>
      </button>
    );
  return (
    <section
      ref={cardRef}
      id={id}
      className="ar-panel"
      aria-label="Comments"
      tabIndex={-1}
      data-testid="comments-panel"
    >
      <header className="ar-panel-head">
        <h2>Comments</h2>
        <span className="ar-tag">{summary}</span>
        <span className="ar-grow" />
        <button
          ref={toggleRef}
          type="button"
          className="ar-icon-button"
          aria-expanded
          aria-controls={id}
          aria-keyshortcuts="Shift+C"
          aria-label="Hide comments"
          title="Hide comments (Shift+C)"
          data-testid="panel-toggle"
          onClick={toggle}
        >
          <PanelRightCloseIcon aria-hidden="true" />
        </button>
      </header>
      <div className="ar-panel-body">{children}</div>
    </section>
  );
}
