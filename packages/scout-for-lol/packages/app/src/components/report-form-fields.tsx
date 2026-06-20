import type { Dispatch, SetStateAction } from "react";
import {
  DEFAULT_REPORT_CRON,
  REPORT_MAX_LOOKBACK_DAYS,
  REPORT_MAX_ROWS_LIMIT,
  ReportOutputFormatSchema,
} from "@scout-for-lol/data";
import { CronPresets } from "@scout-for-lol/data/model/competition-cron.ts";
import {
  buildRenderClause,
  isChartKind,
  renderKindFromQuery,
  renderYFromQuery,
  upsertRenderClause,
} from "#src/lib/render-clause.ts";
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

export const EXAMPLE_QUERY =
  "select games, win_rate from match_participants where queue in (ranked_solo) group by player order by games desc render bar_chart with (y = win_rate)";

export type ReportFormState = {
  title: string;
  description: string;
  channelId: string;
  queryText: string;
  lookbackDays: string;
  maxRows: string;
  cronExpression: string;
};

export const EMPTY_REPORT_STATE: ReportFormState = {
  title: "",
  description: "",
  channelId: "",
  queryText: "",
  lookbackDays: "30",
  maxRows: "10",
  cronExpression: DEFAULT_REPORT_CRON,
};

export type ReportPayload = {
  title: string;
  description: string | null;
  channelId: string;
  queryText: string;
  lookbackDays: number;
  maxRows: number;
  cronExpression: string;
};

/**
 * Parse + validate the string-backed form state into a payload ready for
 * `report.create` / `report.update`. Shared by the report route and the
 * onboarding wizard. The display lives in the query's trailing `RENDER`
 * clause, so there is no separate `outputFormat` field.
 */
export function buildReportPayload(
  state: ReportFormState,
): { ok: true; payload: ReportPayload } | { ok: false; message: string } {
  const lookbackDays = Number(state.lookbackDays);
  const maxRows = Number(state.maxRows);
  if (!Number.isInteger(lookbackDays) || !Number.isInteger(maxRows)) {
    return {
      ok: false,
      message: "Lookback days and max rows must be whole numbers.",
    };
  }
  return {
    ok: true,
    payload: {
      title: state.title,
      description: state.description.trim() === "" ? null : state.description,
      channelId: state.channelId,
      queryText: state.queryText,
      lookbackDays,
      maxRows,
      cronExpression: state.cronExpression,
    },
  };
}

export function ReportFormFields(props: {
  state: ReportFormState;
  setState: Dispatch<SetStateAction<ReportFormState>>;
  channels: { id: string; name: string }[] | undefined;
  /**
   * Metric columns offered as Y-axis choices for chart kinds, sourced from the
   * live preview's result columns. When omitted (e.g. the onboarding wizard has
   * no preview), the Y picker is hidden — the query's existing `RENDER` clause
   * still drives the display, and the first SELECTed metric is plotted.
   */
  metricOptions?: string[];
}) {
  const { state, setState } = props;
  const currentKind = renderKindFromQuery(state.queryText);
  const currentY = renderYFromQuery(state.queryText);
  const metricOptions = props.metricOptions;

  function setRenderKind(kind: string): void {
    setState((prev) => ({
      ...prev,
      queryText: upsertRenderClause(
        prev.queryText,
        buildRenderClause(kind, renderYFromQuery(prev.queryText)),
      ),
    }));
  }

  function setRenderY(yMetric: string): void {
    setState((prev) => ({
      ...prev,
      queryText: upsertRenderClause(
        prev.queryText,
        buildRenderClause(renderKindFromQuery(prev.queryText), yMetric),
      ),
    }));
  }

  return (
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
            setState((prev) => ({ ...prev, description: event.target.value }));
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
            {(props.channels ?? []).map((channel) => (
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
            setState((prev) => ({ ...prev, queryText: event.target.value }));
          }}
          required
        />
        <p className="text-xs text-muted-foreground">
          End the query with a <code>RENDER &lt;kind&gt;</code> clause to set the
          display. The builder below edits that clause for you.
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

      {isChartKind(currentKind) && metricOptions !== undefined && (
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
            Choices come from the live preview. Leave unset to plot the first
            SELECTed metric. For a custom title or axis label, edit the RENDER
            clause directly (e.g. <code>title = &quot;Win %&quot;</code>).
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
              setState((prev) => ({ ...prev, maxRows: event.target.value }));
            }}
          />
        </div>
      </div>
    </div>
  );
}
