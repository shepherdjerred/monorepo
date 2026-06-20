import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ReportIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import { ReportQueryPreview } from "#src/components/report-query-preview.tsx";
import {
  buildReportPayload,
  EMPTY_REPORT_STATE,
  ReportFormFields,
  type ReportFormState,
} from "#src/components/report-form-fields.tsx";

function numberOr(value: string, fallback: number): number {
  return Number(value) || fallback;
}

function previewTitle(title: string): string {
  return title === "" ? "Preview" : title;
}

export function ReportForm() {
  const { guildId, reportId: idParam } = useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const safeGuildId = guildId ?? "";

  const idResult =
    idParam === undefined ? null : ReportIdSchema.safeParse(Number(idParam));
  const isEdit = idResult !== null;
  const reportId =
    idResult?.success === true ? idResult.data : ReportIdSchema.parse(1);

  const [state, setState] = useState<ReportFormState>(EMPTY_REPORT_STATE);
  const [prefilled, setPrefilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);

  const handleColumns = useCallback((columns: string[]) => {
    setPreviewColumns(columns);
  }, []);

  const channelsQuery = useQuery(
    trpc.guild.listChannels.queryOptions(
      { guildId: safeGuildId },
      { enabled: guildId !== undefined },
    ),
  );
  const existingQuery = useQuery(
    trpc.report.get.queryOptions(
      { guildId: safeGuildId, reportId },
      { enabled: guildId !== undefined && idResult?.success === true },
    ),
  );

  const existing = existingQuery.data?.report;

  useEffect(() => {
    if (existing === undefined || prefilled) return;
    setState({
      title: existing.title,
      description: existing.description ?? "",
      channelId: existing.channelId,
      queryText: existing.queryText,
      lookbackDays: existing.lookbackDays.toString(),
      maxRows: existing.maxRows.toString(),
      cronExpression: existing.cronExpression,
    });
    setPrefilled(true);
  }, [existing, prefilled]);

  const createMutation = useMutation(
    trpc.report.create.mutationOptions({
      onSuccess: (created) => {
        void navigate(`/g/${safeGuildId}/reports/${created.id.toString()}`);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );
  const updateMutation = useMutation(
    trpc.report.update.mutationOptions({
      onSuccess: () => {
        void navigate(`/g/${safeGuildId}/reports/${reportId.toString()}`);
      },
      onError: (err) => {
        setError(err.message);
      },
    }),
  );

  if (guildId === undefined || (isEdit && !idResult.success)) {
    return <p className="text-sm text-destructive">Invalid report route.</p>;
  }

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const built = buildReportPayload(state);
    if (!built.ok) {
      setError(built.message);
      return;
    }
    if (isEdit) {
      updateMutation.mutate({
        guildId: safeGuildId,
        reportId,
        ...built.payload,
      });
      return;
    }
    createMutation.mutate({
      guildId: safeGuildId,
      isEnabled: true,
      ...built.payload,
    });
  }

  const pending = createMutation.isPending || updateMutation.isPending;
  // Drop "label" (the GROUP BY dimension) — only metrics are plottable on Y.
  const metricOptions = previewColumns.slice(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          {isEdit ? "Edit report" : "New report"}
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/g/${guildId}/reports`}>Back</Link>
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <ReportFormFields
            state={state}
            setState={setState}
            channels={channelsQuery.data}
            metricOptions={metricOptions}
          />

          {error !== null && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-2">
            <Button asChild variant="outline" type="button">
              <Link to={`/g/${guildId}/reports`}>Cancel</Link>
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>

        <ReportQueryPreview
          guildId={guildId}
          queryText={state.queryText}
          title={previewTitle(state.title)}
          lookbackDays={numberOr(state.lookbackDays, 30)}
          maxRows={numberOr(state.maxRows, 10)}
          onColumns={handleColumns}
        />
      </form>
    </div>
  );
}
