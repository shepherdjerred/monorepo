import { formatInteger } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@scout-for-lol/design-system/components/table";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { formatDate } from "#src/lib/format.ts";

export type BucksLedgerEntryView = {
  id: number;
  delta: number;
  balanceAfter: number;
  label: string;
  matchId: string | null;
  createdAt: Date | string;
};

function signedBucks(delta: number): string {
  return `${delta > 0 ? "+" : ""}${formatInteger(delta)} BB`;
}

/** One frozen page of the caller's own ledger, newest first. */
export function BucksLedgerList(props: {
  entries: BucksLedgerEntryView[];
  page: number;
  totalPages: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onRefresh: () => void;
}) {
  if (props.entries.length === 0) {
    return (
      <EmptyState>
        <p>No Bryan Bucks history yet.</p>
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>What</TableHead>
            <TableHead className="text-right">Change</TableHead>
            <TableHead className="text-right">Balance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.entries.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>{formatDate(entry.createdAt)}</TableCell>
              <TableCell>
                {entry.label}
                {entry.matchId === null ? null : (
                  <span className="text-scout-subtle ml-2 text-xs">
                    {entry.matchId}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {signedBucks(entry.delta)}
              </TableCell>
              <TableCell className="text-right">
                {formatInteger(entry.balanceAfter)} BB
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.page <= 0}
          onClick={props.onPreviousPage}
        >
          Previous
        </Button>
        <span className="text-scout-subtle text-sm">
          Page {formatInteger(props.page + 1)} of{" "}
          {formatInteger(Math.max(props.totalPages, 1))}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.page >= props.totalPages - 1}
          onClick={props.onNextPage}
        >
          Next
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onRefresh}
        >
          Refresh
        </Button>
      </div>
    </div>
  );
}
