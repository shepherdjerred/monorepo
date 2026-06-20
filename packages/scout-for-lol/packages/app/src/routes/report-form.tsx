import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_REPORT_CRON,
  REPORT_MAX_LOOKBACK_DAYS,
  REPORT_MAX_ROWS_LIMIT,
  ReportIdSchema,
  ReportOutputFormatSchema,
} from "@scout-for-lol/data";
import { CronPresets } from "@scout-for-lol/data/model/competition-cron.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import { Textarea } from "#src/components/ui/textarea.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import { ReportQueryPreview } from "#src/components/report-query-preview.tsx";

const EXAMPLE_QUERY =
  "select games, win_rate from match_participants where queue in (ranked_solo) group by player order by games desc render bar_chart with (y = win_rate)";

// The display lives in the query's trailing RENDER clause. These light helpers
// let the builder read/replace that clause without re-implementing the parser;
// the textarea remains the source of truth (and stays hand-editable).
const RENDER_KEYWORD = /(?:^|\s)render\s/i;
const RENDER_KIND =
  /(?:^|\s)render\s+(bar_chart|line_chart|table|list|leaderboard)\b/i;
const RENDER_Y =
  /(?:^|\s)render\s+\w+\s+with\s*\([^)]*\by\s*=\s*['"]?(\w+)['"]?/i;

function renderKindFromQuery(queryText: string): string {
  const kind = RENDER_KIND.exec(queryText)?.[1];
  return kind === undefined ? "TABLE" : kind.toUpperCase();
}

function renderYFromQuery(queryText: string): string {
  return RENDER_Y.exec(queryText)?.[1] ?? "";
}

function isChartKind(kind: string): boolean {
  return kind === "BAR_CHART" || kind === "LINE_CHART";
}

function buildRenderClause(kind: string, yMetric: string): string {
  const token = kind.toLowerCase();
  if (isChartKind(kind) && yMetric.length > 0) {
    return `RENDER ${token} WITH (y = ${yMetric})`;
  }
  return `RENDER ${token}`;
}

function upsertRenderClause(queryText: string, clause: string): string {
  const match = RENDER_KEYWORD.exec(queryText);
  const base =
    match === null
      ? queryText.trimEnd()
      : queryText.slice(0, match.index).trimEnd();
  return base.length === 0 ? clause : `${base} ${clause}`;
}

function numberOr(value: string, fallback: number): number {
  return Number(value) || fallback;
}

function previewTitle(title: string): string {
  return title === "" ? "Preview" : title;
}

type FormState = {
  title: string;
  description: string;
  channelId: string;
  queryText: string;
  lookbackDays: string;
  maxRows: string;
  cronExpression: string;
};

const EMPTY_STATE: FormState = {
  title: "",
  description: "",
  channelId: "",
  queryText: "",
  lookbackDays: "30",
  maxRows: "10",
  cronExpression: DEFAULT_REPORT_CRON,
};

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

  const [state, setState] = useState<FormState>(EMPTY_STATE);
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
    const lookbackDays = Number(state.lookbackDays);
    const maxRows = Number(state.maxRows);
    if (!Number.isInteger(lookbackDays) || !Number.isInteger(maxRows)) {
      setError("Lookback days and max rows must be whole numbers.");
      return;
    }
    const shared = {
      title: state.title,
      description: state.description.trim() === "" ? null : state.description,
      channelId: state.channelId,
      queryText: state.queryText,
      lookbackDays,
      maxRows,
      cronExpression: state.cronExpression,
    };
    if (isEdit) {
      updateMutation.mutate({ guildId: safeGuildId, reportId, ...shared });
      return;
    }
    createMutation.mutate({ guildId: safeGuildId, isEnabled: true, ...shared });
  }

  function setRenderKind(kind: string) {
    setState((prev) => ({
      ...prev,
      queryText: upsertRenderClause(
        prev.queryText,
        buildRenderClause(kind, renderYFromQuery(prev.queryText)),
      ),
    }));
  }

  function setRenderY(yMetric: string) {
    setState((prev) => ({
      ...prev,
      queryText: upsertRenderClause(
        prev.queryText,
        buildRenderClause(renderKindFromQuery(prev.queryText), yMetric),
      ),
    }));
  }

  const pending = createMutation.isPending || updateMutation.isPending;
  const currentKind = renderKindFromQuery(state.queryText);
  const currentY = renderYFromQuery(state.queryText);
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
          <div className="space-y-2">
            <Label htmlFor="report-title">Title</Label>
            <Input
              id="report-title"
              value={state.title}
              onChange={(event) => {
                setState((prev) => ({ ...prev, title: event.target.value }));
              }}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-description">Description (optional)</Label>
            <Input
              id="report-description"
              value={state.description}
              onChange={(event) => {
                setState((prev) => ({
                  ...prev,
                  description: event.target.value,
                }));
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-channel">Channel</Label>
            <Select
              value={state.channelId}
              onValueChange={(next) => {
                setState((prev) => ({ ...prev, channelId: next }));
              }}
              required
            >
              <SelectTrigger id="report-channel">
                <SelectValue placeholder="Pick a channel" />
              </SelectTrigger>
              <SelectContent>
                {(channelsQuery.data ?? []).map((channel) => (
                  <SelectItem key={channel.id} value={channel.id}>
                    #{channel.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="report-query">Query</Label>
            <Textarea
              id="report-query"
              value={state.queryText}
              placeholder={EXAMPLE_QUERY}
              onChange={(event) => {
                setState((prev) => ({
                  ...prev,
                  queryText: event.target.value,
                }));
              }}
              required
            />
            <p className="text-xs text-muted-foreground">
              End the query with a <code>RENDER &lt;kind&gt;</code> clause to
              set the display. The builder below edits that clause for you.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="report-display">Display</Label>
              <Select value={currentKind} onValueChange={setRenderKind}>
                <SelectTrigger id="report-display">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ReportOutputFormatSchema.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-cron">Schedule</Label>
              <Select
                value={state.cronExpression}
                onValueChange={(next) => {
                  setState((prev) => ({ ...prev, cronExpression: next }));
                }}
              >
                <SelectTrigger id="report-cron">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CronPresets.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isChartKind(currentKind) && (
            <div className="space-y-2">
              <Label htmlFor="report-y">Plot metric (Y axis)</Label>
              <Select value={currentY} onValueChange={setRenderY}>
                <SelectTrigger id="report-y">
                  <SelectValue placeholder="First SELECTed metric (default)" />
                </SelectTrigger>
                <SelectContent>
                  {metricOptions.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choices come from the live preview. Leave unset to plot the
                first SELECTed metric. For a custom title or axis label, edit
                the RENDER clause directly (e.g.{" "}
                <code>title = &quot;Win %&quot;</code>).
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="report-lookback">
                Lookback days (max {REPORT_MAX_LOOKBACK_DAYS})
              </Label>
              <Input
                id="report-lookback"
                type="number"
                min={1}
                max={REPORT_MAX_LOOKBACK_DAYS}
                value={state.lookbackDays}
                onChange={(event) => {
                  setState((prev) => ({
                    ...prev,
                    lookbackDays: event.target.value,
                  }));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-max-rows">
                Max rows (max {REPORT_MAX_ROWS_LIMIT})
              </Label>
              <Input
                id="report-max-rows"
                type="number"
                min={1}
                max={REPORT_MAX_ROWS_LIMIT}
                value={state.maxRows}
                onChange={(event) => {
                  setState((prev) => ({
                    ...prev,
                    maxRows: event.target.value,
                  }));
                }}
              />
            </div>
          </div>

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
