import { Loaded } from "@shepherdjerred/loaded";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { ReportResultTable } from "#src/components/report-result-table.tsx";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";

const DEBOUNCE_MS = 500;

export function ReportQueryPreview(props: {
  guildId: string;
  queryText: string;
  title: string;
  sourceCompetitionId: number | null;
}) {
  const { guildId, queryText, title, sourceCompetitionId } = props;
  const trpc = useTRPC();
  const [debounced, setDebounced] = useState({
    queryText,
    title,
    sourceCompetitionId,
  });

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced({ queryText, title, sourceCompetitionId });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [queryText, sourceCompetitionId, title]);

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
        sourceCompetitionId: debounced.sourceCompetitionId,
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

  const preview = Loaded.fromQuery(previewQuery, ["queryPreview"]);
  const result = Loaded.getOrElse(preview, undefined);

  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-semibold">Live preview</h3>
      {!hasQuery && (
        <p className="text-sm text-scout-subtle">
          Write a query to preview its results.
        </p>
      )}
      {hasQuery && preview.status === "loading" && (
        <p className="text-sm text-scout-subtle">Running preview…</p>
      )}
      {(preview.status === "error" || preview.status === "degraded") && (
        <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-scout-danger bg-scout-danger p-3 text-xs text-scout-danger-ink">
          {Loaded.messageOf(preview.errors[0].error)}
        </pre>
      )}
      {result !== undefined && preview.status !== "degraded" && (
        <>
          {previewQuery.isFetching && (
            <p className="text-xs text-scout-subtle">Updating…</p>
          )}
          {result.visualization !== null &&
          result.renderKind !== "TABLE" &&
          result.renderKind !== "LIST" &&
          result.renderKind !== "LEADERBOARD" ? (
            <InteractiveVisualization snapshot={result.visualization} />
          ) : result.imageBase64 === null ? null : (
            <img
              className="w-full rounded-md border border-border"
              src={`data:image/png;base64,${result.imageBase64}`}
              alt={`${result.renderKind} preview`}
            />
          )}
          <ReportResultTable
            columns={result.columns}
            rows={result.rows}
            visualization={result.visualization}
            evidence={result.evidence}
          />
          <p className="text-xs text-scout-subtle">
            {result.rows.length} row(s) · {result.rowsScanned} fact row(s)
            scanned
          </p>
        </>
      )}
    </div>
  );
}
