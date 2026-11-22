import { useId, type ReactNode } from "react";

export type MatrixCellStatus = "ok" | "warning" | "error" | "missing" | "info";

export type StatusMatrixCell = {
  readonly status: MatrixCellStatus;
  readonly label?: string | undefined;
  readonly detail?: string | undefined;
};

export type StatusMatrixColumn = {
  readonly key: string;
  readonly label: string;
};

export type StatusMatrixRow = {
  readonly key: string;
  readonly label: ReactNode;
  readonly meta?: ReactNode | undefined;
  readonly cells: Readonly<Record<string, StatusMatrixCell>>;
};

export type StatusMatrixProps = {
  readonly caption: string;
  readonly hideCaption?: boolean | undefined;
  readonly rowHeaderLabel?: string | undefined;
  readonly columns: readonly StatusMatrixColumn[];
  readonly rows: readonly StatusMatrixRow[];
  readonly emptyMessage?: string | undefined;
};

export const MATRIX_GLYPH: Record<MatrixCellStatus, string> = {
  ok: "✓",
  warning: "!",
  error: "✕",
  missing: "—",
  info: "•",
};

export const MATRIX_STATUS_LABEL: Record<MatrixCellStatus, string> = {
  ok: "OK",
  warning: "Warning",
  error: "Error",
  missing: "Missing",
  info: "Info",
};

/** Each matrix status on the shared severity vocabulary; missing is unknown. */
const MATRIX_SEVERITY: Record<
  MatrixCellStatus,
  "ok" | "warning" | "error" | "unknown" | "info"
> = {
  ok: "ok",
  warning: "warning",
  error: "error",
  missing: "unknown",
  info: "info",
};

function renderMatrixCell(
  cell: StatusMatrixCell | undefined,
): React.JSX.Element {
  const status: MatrixCellStatus = cell?.status ?? "missing";
  const statusWord = MATRIX_STATUS_LABEL[status];
  const visibleLabel = cell?.label ?? statusWord;
  const needsStatusPrefix =
    cell?.label !== undefined &&
    !cell.label.toLowerCase().includes(statusWord.toLowerCase());

  return (
    <>
      <span
        className="visual-matrix-cell"
        data-sev={MATRIX_SEVERITY[status]}
        title={cell?.detail}
      >
        <span className="visual-matrix-glyph" aria-hidden="true">
          {MATRIX_GLYPH[status]}
        </span>
        {needsStatusPrefix ? (
          <span className="sr-only">{`${statusWord}: `}</span>
        ) : null}
        <span className="visual-matrix-text">{visibleLabel}</span>
      </span>
      {cell?.detail === undefined ? null : (
        <span className="sr-only">{` (${cell.detail})`}</span>
      )}
    </>
  );
}

/**
 * Accessible 2D operational health matrix. Every cell pairs a non-color glyph
 * (`✓`, `!`, `✕`, `—`, `•`) with semantic badge styling and status words.
 */
export function StatusMatrix({
  caption,
  hideCaption = false,
  rowHeaderLabel = "Target",
  columns,
  rows,
  emptyMessage = "No matrix rows reported.",
}: StatusMatrixProps): React.JSX.Element {
  const captionId = useId();

  return (
    <div className="visual-matrix-wrapper">
      <div
        className="visual-matrix-region"
        role="region"
        aria-labelledby={captionId}
        tabIndex={0}
      >
        <table className="visual-matrix-table">
          <caption
            id={captionId}
            className={hideCaption ? "sr-only" : "visual-table-caption"}
          >
            {caption}
          </caption>
          <thead>
            <tr>
              <th scope="col">{rowHeaderLabel}</th>
              {columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="visual-empty-cell">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="visual-matrix-rowhead"
                    data-label={rowHeaderLabel}
                  >
                    <span>{row.label}</span>
                    {row.meta === undefined ? null : (
                      <span className="visual-matrix-row-meta">{row.meta}</span>
                    )}
                  </th>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-label={column.label}
                      className="visual-matrix-td"
                    >
                      {renderMatrixCell(row.cells[column.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
