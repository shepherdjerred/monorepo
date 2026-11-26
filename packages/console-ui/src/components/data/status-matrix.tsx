import { MinusIcon } from "lucide-react";
import { useId, type ReactNode } from "react";
import {
  SEVERITY_LABEL,
  StatusGlyph,
} from "@shepherdjerred/console-ui/components/status-glyph.tsx";
import type { Severity } from "@shepherdjerred/console-ui/tokens.ts";

/** A cell's status: a severity, or `missing` when nothing reported. */
export type MatrixStatus = Severity | "missing";

export type StatusMatrixCell = {
  readonly status: MatrixStatus;
  /** Short visible text ("2h ago"); the status word by default. */
  readonly label?: string | undefined;
  /** Shown on hover and read after the label ("SLA 24h"). */
  readonly detail?: string | undefined;
};

export type StatusMatrixColumn = {
  readonly key: string;
  readonly label: string;
};

export type StatusMatrixRow = {
  readonly key: string;
  readonly label: ReactNode;
  readonly meta?: ReactNode;
  /** Cells by column key; a column without a cell reads as missing. */
  readonly cells: Readonly<Record<string, StatusMatrixCell>>;
};

export type StatusMatrixProps = {
  readonly caption: string;
  readonly hideCaption?: boolean | undefined;
  /** The first column's header; "Target" by default. */
  readonly rowHeaderLabel?: string | undefined;
  readonly columns: readonly StatusMatrixColumn[];
  readonly rows: readonly StatusMatrixRow[];
  readonly emptyMessage?: string | undefined;
};

export const MATRIX_STATUS_LABEL: Readonly<Record<MatrixStatus, string>> = {
  ...SEVERITY_LABEL,
  missing: "Missing",
};

function MatrixCell({
  cell,
}: {
  readonly cell: StatusMatrixCell | undefined;
}): React.JSX.Element {
  const status = cell?.status ?? "missing";
  const word = MATRIX_STATUS_LABEL[status];
  const text = cell?.label ?? word;
  // Status is never colour alone: a label without the word gets it read first.
  const prefixed =
    cell?.label !== undefined &&
    !cell.label.toLowerCase().includes(word.toLowerCase());
  return (
    <span className="ui-matrix-cell" title={cell?.detail}>
      <StatusGlyph
        severity={status === "missing" ? "unknown" : status}
        {...(status === "missing" ? { icon: MinusIcon } : {})}
        label={
          <>
            {prefixed ? (
              <span className="ui-sr-only">{`${word}: `}</span>
            ) : null}
            {text}
            {cell?.detail === undefined ? null : (
              <span className="ui-sr-only">{` (${cell.detail})`}</span>
            )}
          </>
        }
      />
    </span>
  );
}

/**
 * A grid of targets against checks: every cell a status glyph and a short
 * label, with `missing` for checks that never reported. It is a `ui-table`
 * in a keyboard-scrollable region named by its caption.
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
    <div
      className="ui-table-scroll"
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
    >
      <table className="ui-table ui-matrix">
        <caption
          id={captionId}
          className={hideCaption ? "ui-sr-only" : undefined}
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
            <tr className="ui-table-empty">
              <td colSpan={columns.length + 1}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.label}
                  {row.meta === undefined ? null : (
                    <span className="ui-matrix-meta">{row.meta}</span>
                  )}
                </th>
                {columns.map((column) => (
                  <td key={column.key} data-label={column.label}>
                    <MatrixCell cell={row.cells[column.key]} />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
