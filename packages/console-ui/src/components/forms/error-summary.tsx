import { useEffect, useRef } from "react";
import { StatusGlyph } from "@shepherdjerred/console-ui/components/status-glyph.tsx";

export type ErrorSummaryItem = {
  /** The `id` of the invalid control (from `Field`'s control props). */
  readonly fieldId: string;
  readonly label: string;
  readonly message: string;
};

export type ErrorSummaryProps = {
  readonly errors: readonly ErrorSummaryItem[];
  /** Move focus to the summary when it appears (after a failed submit). */
  readonly focusOnMount?: boolean;
};

/**
 * The list of problems above a form after a failed submit. It is a focus
 * target and a live alert; each entry links to its control and focuses it.
 */
export function ErrorSummary({
  errors,
  focusOnMount = false,
}: ErrorSummaryProps): React.JSX.Element | null {
  const root = useRef<HTMLDivElement>(null);
  const count = errors.length;
  useEffect(() => {
    if (focusOnMount && count > 0) root.current?.focus();
  }, [focusOnMount, count]);
  if (count === 0) return null;
  return (
    <div
      ref={root}
      className="ui-error-summary"
      role="alert"
      aria-live="assertive"
      tabIndex={-1}
    >
      <h2 className="ui-error-summary-title">
        <StatusGlyph
          severity="error"
          label={
            count === 1
              ? "1 problem to fix"
              : `${String(count)} problems to fix`
          }
        />
      </h2>
      <ul>
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              onClick={(event) => {
                const target = document.querySelector(
                  `#${CSS.escape(error.fieldId)}`,
                );
                if (!(target instanceof HTMLElement)) return;
                event.preventDefault();
                target.focus();
              }}
            >
              {error.label}
            </a>
            : {error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
