import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
  const [debounced, setDebounced] = useState({ queryText, title });

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced({ queryText, title });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [queryText, title]);

  // Re-run whenever the debounced query/title change. The display format comes
  // from the query's RENDER clause, parsed server-side. keepPreviousData keeps
  // the last result on screen while the next preview loads so it doesn't flash.
  const hasQuery = debounced.queryText.trim().length > 0;
  const previewQuery = useQuery(
    trpc.report.previewQuery.queryOptions(
      {
        guildId,
        queryText: debounced.queryText,
        title: debounced.title,
      },
      {
        enabled: hasQuery,
        placeholderData: keepPreviousData,
        // A live editor pauses on invalid/incomplete ScoutQL constantly; those
        // are deterministic parse/execution errors, so retrying just delays the
        // error message and repeats the embedded DuckDB/Parquet work.
        retry: false,
        // Each debounced query text/title is a distinct cache entry, and a
        // successful preview carries the full PNG in `imageBase64`. Evict
        // inactive entries immediately so paused edits don't leave many large
        // encoded images resident in browser memory (keepPreviousData still
        // holds the last result on screen during the next fetch).
        gcTime: 0,
      },
    ),
  );

  const result = previewQuery.data;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Live preview</h3>
      {!hasQuery && (
        <p className="text-sm text-muted-foreground">
          Write a query to preview its results.
        </p>
      )}
      {hasQuery && previewQuery.isPending && (
        <p className="text-sm text-muted-foreground">Running preview…</p>
      )}
      {previewQuery.error !== null && (
        <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-xs text-destructive">
          {previewQuery.error.message}
        </pre>
      )}
      {result !== undefined && previewQuery.error === null && (
        <>
          {previewQuery.isFetching && (
            <p className="text-xs text-muted-foreground">Updating…</p>
          )}
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
