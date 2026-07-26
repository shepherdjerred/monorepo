import { Link, useNavigate } from "react-router";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import type { ReportId } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { analyticsMeta } from "#src/lib/analytics.ts";
import { channelLabel } from "#src/lib/format.ts";
import { usePermissions } from "#src/hooks/use-permissions.ts";
import { useReportParams } from "#src/lib/route-params.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Badge } from "#src/components/ui/badge.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { ReportRunHistory } from "#src/components/report-run-history.tsx";
import { ReportQueryViewer } from "#src/components/report-query-viewer.tsx";

type ReportRow = {
  description: string | null;
  channelId: string;
  cronExpression: string;
  scheduleTimezone: string;
  isEnabled: boolean;
  queryText: string;
  sourceCompetitionId: number | null;
};

function ReportHeaderActions(props: {
  guildId: string;
  reportId: ReportId;
  title: string;
  systemManaged: boolean;
  canEdit: boolean;
  canRun: boolean;
  canDelete: boolean;
  onRun: () => void;
  runPending: boolean;
  onDelete: () => void;
  deletePending: boolean;
}) {
  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to={`/g/${props.guildId}/reports`}>Back</Link>
      </Button>
      {!props.systemManaged && props.canEdit && (
        <Button asChild variant="outline" size="sm">
          <Link
            to={`/g/${props.guildId}/reports/${props.reportId.toString()}/edit`}
          >
            Edit
          </Link>
        </Button>
      )}
      {props.canRun && (
        <Button
          type="button"
          size="sm"
          disabled={props.runPending}
          onClick={props.onRun}
        >
          {props.runPending ? "Running…" : "Run now"}
        </Button>
      )}
      {!props.systemManaged && props.canDelete && (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={props.deletePending}
          onClick={props.onDelete}
        >
          Delete
        </Button>
      )}
    </div>
  );
}

function ReportDefinitionCards(props: {
  guildId: string;
  report: ReportRow;
  channels: { id: string; name: string }[] | undefined;
}) {
  const { guildId, report, channels } = props;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Definition</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {report.description !== null && (
            <p className="text-muted-foreground">{report.description}</p>
          )}
          <p>
            <span className="text-muted-foreground">Channel:</span>{" "}
            {channelLabel(channels, report.channelId)}
          </p>
          <p>
            <span className="text-muted-foreground">Schedule:</span>{" "}
            <span className="font-mono text-xs">{report.cronExpression}</span> ·{" "}
            {report.scheduleTimezone} ·{" "}
            {report.isEnabled ? "enabled" : "disabled"}
          </p>
          {report.sourceCompetitionId !== null && (
            <Link
              className="text-sm underline"
              to={`/g/${guildId}/competitions/${report.sourceCompetitionId.toString()}`}
            >
              View source competition
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Query</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportQueryViewer queryText={report.queryText} />
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportDetail() {
  const { guildId, reportId } = useReportParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { perms } = usePermissions(guildId);

  const getKey = trpc.report.get.queryKey({ guildId, reportId });
  const reportQuery = useSuspenseQuery(
    trpc.report.get.queryOptions({ guildId, reportId }),
  );
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions({ guildId }),
  );
  const runMutation = useMutation(
    trpc.report.run.mutationOptions({
      meta: analyticsMeta("report_run"),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getKey });
      },
    }),
  );
  const deleteMutation = useMutation(
    trpc.report.delete.mutationOptions({
      meta: analyticsMeta("report_deleted"),
      onSuccess: () => {
        void navigate(`/g/${guildId}/reports`);
      },
    }),
  );

  const report = reportQuery.data.report;
  const runs = reportQuery.data.runs;
  const systemManaged = report.isSystemManaged;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {report.title}
          </h2>
          {systemManaged && <Badge variant="outline">System</Badge>}
        </div>
        <ReportHeaderActions
          guildId={guildId}
          reportId={reportId}
          title={report.title}
          systemManaged={systemManaged}
          canEdit={perms.can("reports", "update")}
          canRun={perms.can("reports", "run")}
          canDelete={perms.can("reports", "delete")}
          onRun={() => {
            runMutation.mutate({ guildId, reportId });
          }}
          runPending={runMutation.isPending}
          onDelete={() => {
            if (!globalThis.confirm(`Delete "${report.title}"?`)) {
              return;
            }
            deleteMutation.mutate({ guildId, reportId });
          }}
          deletePending={deleteMutation.isPending}
        />
      </div>

      {runMutation.error && (
        <p className="text-sm text-destructive">{runMutation.error.message}</p>
      )}
      {deleteMutation.error && (
        <p className="text-sm text-destructive">
          {deleteMutation.error.message}
        </p>
      )}

      <ReportDefinitionCards
        guildId={guildId}
        report={report}
        channels={channelsQuery.data}
      />
      <ReportRunHistory guildId={guildId} reportId={reportId} runs={runs} />
    </div>
  );
}
