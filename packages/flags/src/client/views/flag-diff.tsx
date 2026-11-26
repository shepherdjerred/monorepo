import { sideBySide, type DiffCell } from "./line-diff.ts";

export type FlagDiffProps = {
  /** Pretty-printed text of the left side; empty when that side is absent. */
  readonly left: string;
  readonly right: string;
  readonly leftLabel: string;
  readonly rightLabel: string;
};

function Cells({
  cell,
  side,
}: {
  readonly cell: DiffCell | undefined;
  readonly side: "left" | "right";
}): React.JSX.Element {
  if (cell === undefined) {
    return (
      <>
        <td className="fl-diff-num" />
        <td className="fl-diff-gap" />
      </>
    );
  }
  const severity = cell.changed
    ? side === "left"
      ? "error"
      : "ok"
    : undefined;
  return (
    <>
      <td className="fl-diff-num">{cell.number}</td>
      <td className="fl-diff-text" data-sev={severity}>
        <span className="fl-diff-mark" aria-hidden="true">
          {cell.changed ? (side === "left" ? "−" : "+") : " "}
        </span>
        {cell.changed ? (
          <span className="ui-sr-only">
            {side === "left" ? "removed: " : "added: "}
          </span>
        ) : null}
        {cell.text}
      </td>
    </>
  );
}

/**
 * Two texts side by side, line-aligned: lines only on the left are marked
 * removed, lines only on the right added. Dependency-free, so it suits small
 * documents such as one flag's JSON.
 */
export function FlagDiff({
  left,
  right,
  leftLabel,
  rightLabel,
}: FlagDiffProps): React.JSX.Element {
  const rows = sideBySide(left, right);
  return (
    <div
      className="fl-diff-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${leftLabel} compared with ${rightLabel}`}
    >
      <table className="fl-diff">
        <colgroup>
          <col className="fl-diff-num-col" />
          <col />
          <col className="fl-diff-num-col" />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" colSpan={2}>
              {leftLabel}
            </th>
            <th scope="col" colSpan={2}>
              {rightLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <Cells cell={row.left} side="left" />
              <Cells cell={row.right} side="right" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
