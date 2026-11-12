import type { CSSProperties } from "react";

/** The ring's fill, read by CSS as a custom property. */
function ringStyle(value: number): CSSProperties & { "--value": number } {
  return { "--value": value };
}

const percent = (done: number, total: number) =>
  total === 0 ? 0 : Math.round((done / total) * 100);

/**
 * How many sub-issues are done, as a ring. The `<progress>` element carries
 * the value for assistive technology; CSS draws it with a conic gradient.
 */
export function ProgressRing({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label: string;
}) {
  const value = percent(done, total);
  return (
    <progress
      className="progress-ring"
      max={100}
      value={value}
      aria-label={label}
      aria-valuetext={`${String(done)} of ${String(total)} done`}
      data-complete={done === total && total > 0 ? "" : undefined}
      style={ringStyle(value)}
    />
  );
}

/** The "◔ 2/5" a row or card shows for an issue with sub-issues. */
export function SubIssueBadge({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  if (total === 0) {
    return null;
  }
  const value = percent(done, total);
  return (
    <span
      className="sub-issue-badge"
      title={`${String(done)} of ${String(total)} sub-issues done`}
    >
      <span
        className="ring-mark"
        aria-hidden="true"
        data-complete={done === total ? "" : undefined}
        style={ringStyle(value)}
      />
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <span className="sr-only">
        {done} of {total} sub-issues done
      </span>
    </span>
  );
}
