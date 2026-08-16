import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/table.tsx";

export type ReportResultColumn<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
};
export function ReportResultTable<Row>(props: {
  rows: Row[];
  columns: ReportResultColumn<Row>[];
  getRowKey: (row: Row) => string;
  caption: string;
}) {
  return (
    <Table>
      <caption className="scout-sr-only">{props.caption}</caption>
      <TableHeader>
        <TableRow>
          {props.columns.map((column) => (
            <TableHead key={column.key}>{column.header}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row) => (
          <TableRow key={props.getRowKey(row)}>
            {props.columns.map((column) => (
              <TableCell key={column.key}>{column.render(row)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
