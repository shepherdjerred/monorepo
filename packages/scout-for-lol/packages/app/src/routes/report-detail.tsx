import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportIdSchema, type ReportId } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { channelLabel } from "#src/lib/format.ts";
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
      {!props.systemManaged && (
        <Button asChild variant="outline" size="sm">
          <Link
            to={`/g/${props.guildId}/reports/${props.reportId.toString()}/edit`}
          >
            Edit
          </Link>
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        disabled={props.runPending}
        onClick={props.onRun}
      >
        {props.runPending ? "Running…" : "Run now"}
      </Button>
      {!props.systemManaged && (
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
  const { guildId, reportId: idParam } = useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";

  const idResult = ReportIdSchema.safeParse(Number(idParam));
  const reportId = idResult.success ? idResult.data : ReportIdSchema.parse(1);
  const enabled = guildId !== undefined && idResult.success;

  const getKey = trpc.report.get.queryKey({ guildId: safeGuildId, reportId });
  const reportQuery = useQuery(
    trpc.report.get.queryOptions(
      { guildId: safeGuildId, reportId },
      { enabled },
    ),
  );
  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const runMutation = useMutation(
    trpc.report.run.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getKey });
      },
    }),
  );
  const deleteMutation = useMutation(
    trpc.report.delete.mutationOptions({
      onSuccess: () => {
        void navigate(`/g/${safeGuildId}/reports`);
      },
    }),
  );

  if (guildId === undefined || !idResult.success) {
    return <p className="text-sm text-destructive">Invalid report route.</p>;
  }

  const report = reportQuery.data?.report;
  const runs = reportQuery.data?.runs ?? [];
  const systemManaged = report?.isSystemManaged === true;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {report?.title ?? "Report"}
          </h2>
          {systemManaged && <Badge variant="outline">System</Badge>}
        </div>
        <ReportHeaderActions
          guildId={guildId}
          reportId={reportId}
          title={report?.title ?? "this report"}
          systemManaged={systemManaged}
          onRun={() => {
            runMutation.mutate({ guildId, reportId });
          }}
          runPending={runMutation.isPending}
          onDelete={() => {
            if (
              !globalThis.confirm(`Delete "${report?.title ?? "this report"}"?`)
            ) {
              return;
            }
            deleteMutation.mutate({ guildId, reportId });
          }}
          deletePending={deleteMutation.isPending}
        />
      </div>

      {reportQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading report…</p>
      )}
      {reportQuery.error && (
        <p className="text-sm text-destructive">
          Failed to load: {reportQuery.error.message}
        </p>
      )}
      {runMutation.error && (
        <p className="text-sm text-destructive">{runMutation.error.message}</p>
      )}
      {deleteMutation.error && (
        <p className="text-sm text-destructive">
          {deleteMutation.error.message}
        </p>
      )}

      {report && (
        <>
          <ReportDefinitionCards
            guildId={guildId}
            report={report}
            channels={channelsQuery.data}
          />
          <ReportRunHistory guildId={guildId} reportId={reportId} runs={runs} />
        </>
      )}
    </div>
  );
}
