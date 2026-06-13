import type { ReportId } from "@scout-for-lol/data";
import { formatDate } from "#src/lib/format.ts";
import { ChartImage } from "#src/components/chart-image.tsx";
import { Section } from "#src/components/section.tsx";
import { ReportRunStatusBadge } from "#src/components/status-badge.tsx";

type Run = {
  id: number;
  trigger: string;
  status: string;
  outputFormat: string;
  startedAt: Date | string;
  durationMs: number | null;
  rowsReturned: number;
  rowsScanned: number;
  errorMessage: string | null;
  renderedContent: string | null;
  hasImage: boolean;
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
          <p className="text-sm text-muted-foreground">
            No runs yet — use “Run now” to generate one.
          </p>
        ) : (
          runs.map((run) => (
            <div
              key={run.id}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                <p className="text-sm text-destructive">{run.errorMessage}</p>
              )}

              {run.renderedContent !== null && (
                <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-3 text-xs">
                  {run.renderedContent}
                </pre>
              )}

              {run.hasImage && (
                <ChartImage
                  src={`/api/report/${reportId.toString()}/runs/${run.id.toString()}.png`}
                  alt="Report chart"
                />
              )}
            </div>
          ))
        )}
      </div>
    </Section>
  );
}
