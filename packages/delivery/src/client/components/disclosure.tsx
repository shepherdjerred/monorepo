import type { ReactNode } from "react";

/** A native `<details>` with a styled summary and an optional count, for collapsing a long list. */
export function Disclosure({
  summary,
  count,
  open = false,
  children,
}: {
  summary: ReactNode;
  /** How many items the disclosure holds, shown beside the summary. */
  count?: number;
  /** Whether it starts open; the reader's own toggling is kept afterwards. */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="disclosure" open={open}>
      <summary>
        <span className="disclosure-label">{summary}</span>
        {count !== undefined && (
          <span className="disclosure-count">{count}</span>
        )}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
