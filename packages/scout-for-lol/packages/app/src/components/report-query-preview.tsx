import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#src/components/ui/table.tsx";

const DEBOUNCE_MS = 500;

export function ReportQueryPreview(props: {
  guildId: string;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
}) {
  const { guildId, queryText, lookbackDays, maxRows } = props;
  const trpc = useTRPC();
  const previewMutation = useMutation(
    trpc.report.previewQuery.mutationOptions(),
  );
  const [debounced, setDebounced] = useState(queryText);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(queryText);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [queryText]);

  // Re-run whenever the debounced query (or limits) change.
  const { mutate } = previewMutation;
  useEffect(() => {
    if (debounced.trim().length === 0) return;
    mutate({ guildId, queryText: debounced, lookbackDays, maxRows });
  }, [mutate, guildId, debounced, lookbackDays, maxRows]);

  const result = previewMutation.data;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Live preview</h3>
      {debounced.trim().length === 0 && (
        <p className="text-sm text-muted-foreground">
          Write a query to preview its results.
        </p>
      )}
      {previewMutation.isPending && (
        <p className="text-sm text-muted-foreground">Running preview…</p>
      )}
      {previewMutation.error && (
        <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-xs text-destructive">
          {previewMutation.error.message}
        </pre>
      )}
      {result && (
        <>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  {result.columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row, rowIndex) => (
                  <TableRow key={`${row.label}-${rowIndex.toString()}`}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    {row.values.map((value, valueIndex) => (
                      <TableCell
                        key={`${value.column}-${valueIndex.toString()}`}
                      >
                        {typeof value.value === "number"
                          ? value.value.toString()
                          : value.value}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            {result.rows.length} row(s) · {result.rowsScanned} fact row(s)
            scanned
          </p>
        </>
      )}
    </div>
  );
}
