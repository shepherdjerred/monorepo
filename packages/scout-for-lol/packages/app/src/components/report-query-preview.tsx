import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ReportOutputFormat } from "@scout-for-lol/data";
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

// Encode an SVG string as a base64 data URI. Rendering via <img> (rather than
// dangerouslySetInnerHTML) means any user-controlled text baked into the SVG
// (player aliases) cannot execute scripts — <img> renders SVG in image mode.
function svgToDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export function ReportQueryPreview(props: {
  guildId: string;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
  outputFormat: ReportOutputFormat;
}) {
  const { guildId, queryText, lookbackDays, maxRows, outputFormat } = props;
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

  // Re-run whenever the debounced query (or limits / format) change.
  const { mutate } = previewMutation;
  useEffect(() => {
    if (debounced.trim().length === 0) return;
    mutate({
      guildId,
      queryText: debounced,
      lookbackDays,
      maxRows,
      outputFormat,
    });
  }, [mutate, guildId, debounced, lookbackDays, maxRows, outputFormat]);

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
        <div className="space-y-3">
          {result.output.kind === "chart" ? (
            <div className="rounded-md border border-border bg-white p-2">
              <img
                src={svgToDataUri(result.output.svg)}
                alt="Report chart preview"
                className="h-auto w-full"
              />
            </div>
          ) : (
            <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-xs">
              {result.output.content}
            </pre>
          )}

          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
              Data table ({result.rows.length} row(s))
            </summary>
            <div className="overflow-auto border-t border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {result.columnLabels.map((label, index) => (
                      <TableHead
                        key={`${result.columns[index] ?? "col"}-${index.toString()}`}
                      >
                        {label}
                      </TableHead>
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
          </details>

          <p className="text-xs text-muted-foreground">
            {result.rows.length} row(s) · {result.rowsScanned} fact row(s)
            scanned
          </p>
        </div>
      )}
    </div>
  );
}
