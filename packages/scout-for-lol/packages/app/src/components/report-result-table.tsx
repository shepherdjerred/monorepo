import {
  formatReportDisplayValue,
  type ReportAiPreviewSummary,
  type ReportResultColumn,
} from "@scout-for-lol/data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

type PreviewRow = ReportAiPreviewSummary["rows"][number];

export function ReportResultTable(props: {
  columns: ReportResultColumn[];
  rows: PreviewRow[];
}) {
  if (props.rows.length === 0) {
    return (
      <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
        No rows matched this query.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {props.columns.map((column) => (
              <TableHead key={column.key}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row, rowIndex) => (
            <TableRow key={`${row.label}-${rowIndex.toString()}`}>
              {props.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={column.key === "label" ? "font-medium" : undefined}
                >
                  {formatCell(column, row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatCell(column: ReportResultColumn, row: PreviewRow): string {
  if (column.key === "label") {
    return row.label;
  }
  const value = row.values.find((entry) => entry.column === column.key)?.value;
  return value === undefined ? "—" : formatReportDisplayValue(column, value);
}
