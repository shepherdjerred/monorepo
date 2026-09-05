import type { ReportId, VisualizationSnapshot } from "@scout-for-lol/data";
import { formatDate } from "#src/lib/format.ts";
import { ChartImage } from "#src/components/chart-image.tsx";
import { Section } from "#src/components/section.tsx";
import { ReportRunStatusBadge } from "#src/components/status-badge.tsx";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";

type Run = {
  id: number;
  trigger: string;
  status: string;
  startedAt: Date | string;
  durationMs: number | null;
  rowsReturned: number;
  rowsScanned: number;
  errorMessage: string | null;
  renderedContent: string | null;
  hasImage: boolean;
  visualization: VisualizationSnapshot | null;
  querySnapshot: string | null;
};

export function ReportRunHistory(props: {
  guildId: string;
  reportId: ReportId;
  runs: Run[];
}) {
  const { reportId, runs } = props;

  return (
    <Section title="Run history">
      <div className="space-y-3 p-3">
        {runs.length === 0 ? (
          <p className="text-sm text-scout-subtle">
            No runs yet — use “Run now” to generate one.
          </p>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-scout-subtle">
                <ReportRunStatusBadge status={run.status} />
                <span>{run.trigger}</span>
                <span>·</span>
                <span>{formatDate(run.startedAt)}</span>
                {run.durationMs !== null && (
                  <>
                    <span>·</span>
                    <span>{run.durationMs} ms</span>
                  </>
                )}
                <span>·</span>
                <span>
                  {run.rowsReturned} rows / {run.rowsScanned} scanned
                </span>
              </div>

              {run.errorMessage !== null && (
                <p className="text-sm text-scout-danger">{run.errorMessage}</p>
              )}

              {run.querySnapshot !== null && (
                <details className="rounded-md border border-border">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-scout-subtle">
                    ScoutQL snapshot
                  </summary>
                  <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words border-t border-border bg-scout-hover/50 p-3 font-mono text-xs leading-5">
                    {run.querySnapshot}
                  </pre>
                </details>
              )}

              {run.renderedContent !== null && (
                <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-scout-hover/50 p-3 text-xs">
                  {run.renderedContent}
                </pre>
              )}

              <RunVisualization
                reportId={reportId}
                runId={run.id}
                hasImage={run.hasImage}
                visualization={run.visualization}
              />
            </div>
          ))
        )}
      </div>
    </Section>
  );
}

function RunVisualization(props: {
  reportId: ReportId;
  runId: number;
  hasImage: boolean;
  visualization: VisualizationSnapshot | null;
}) {
  if (props.visualization !== null) {
    const textKind =
      props.visualization.kind === "TABLE" ||
      props.visualization.kind === "LIST" ||
      props.visualization.kind === "LEADERBOARD";
    return textKind && !props.visualization.display.sparkline ? null : (
      <InteractiveVisualization snapshot={props.visualization} />
    );
  }
  return props.hasImage ? (
    <ChartImage
      src={`/api/report/${props.reportId.toString()}/runs/${props.runId.toString()}.png`}
      alt="Report chart"
    />
  ) : null;
}
