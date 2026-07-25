import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { ReportResultTable } from "#src/components/report-result-table.tsx";

const DEBOUNCE_MS = 500;

export function ReportQueryPreview(props: {
  guildId: string;
  queryText: string;
  title: string;
}) {
  const { guildId, queryText, title } = props;
  const trpc = useTRPC();
  const previewMutation = useMutation(
    trpc.report.previewQuery.mutationOptions(),
  );
  const [debounced, setDebounced] = useState({ queryText, title });

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced({ queryText, title });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [queryText, title]);

  // Re-run whenever the debounced query/title (or limits) change. The display
  // format comes from the query's RENDER clause, parsed server-side.
  const { mutate } = previewMutation;
  useEffect(() => {
    if (debounced.queryText.trim().length === 0) return;
    mutate({
      guildId,
      queryText: debounced.queryText,
      title: debounced.title,
    });
  }, [mutate, guildId, debounced]);

  const result = previewMutation.data;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Live preview</h3>
      {debounced.queryText.trim().length === 0 && (
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
          {result.imageBase64 !== null && (
            <img
              className="w-full rounded-md border border-border"
              src={`data:image/png;base64,${result.imageBase64}`}
              alt={`${result.renderKind} preview`}
            />
          )}
          <ReportResultTable columns={result.columns} rows={result.rows} />
          <p className="text-xs text-muted-foreground">
            {result.rows.length} row(s) · {result.rowsScanned} fact row(s)
            scanned
          </p>
        </>
      )}
    </div>
  );
}
