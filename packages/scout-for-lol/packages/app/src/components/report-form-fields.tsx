import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
  DEFAULT_REPORT_CRON,
  REPORT_MAX_LOOKBACK_DAYS,
  REPORT_MAX_ROWS_LIMIT,
} from "@scout-for-lol/data";
import { CronPresets } from "@scout-for-lol/data/model/competition-cron.ts";
import { Button } from "#src/components/ui/button.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import { ReportQueryDocs } from "#src/components/report-query-docs.tsx";

// Lazy so Monaco is split out of the main bundle and only loaded with this form.
const ReportQueryEditor = lazy(
  () => import("#src/components/report-query-editor.tsx"),
);

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
  if (state.queryText.trim() === "") {
    return { ok: false, message: "Query is required." };
  }
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
  // When provided, renders a "Full reference" link next to the Query label
  // (the report route passes its guild-scoped help route; onboarding omits it).
  queryHelpHref?: string;
}) {
  const { state, setState, queryHelpHref } = props;
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
        <div className="flex items-center justify-between">
          <Label>Query</Label>
          {queryHelpHref !== undefined && (
            <Button asChild variant="link" size="sm">
              <Link to={queryHelpHref}>Full reference</Link>
            </Button>
          )}
        </div>
        <Suspense
          fallback={
            <div className="flex h-[180px] items-center justify-center rounded-md border border-border text-sm text-muted-foreground">
              Loading editor…
            </div>
          }
        >
          <ReportQueryEditor
            value={state.queryText}
            onChange={(value) => {
              setState((prev) => ({ ...prev, queryText: value }));
            }}
          />
        </Suspense>
        <p className="text-xs text-muted-foreground">
          End the query with a <code>RENDER &lt;kind&gt;</code> clause to set the
          display, e.g. <code>RENDER bar_chart with (y = win_rate)</code>. The
          editor autocompletes the kinds and options.
        </p>
        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            Query reference
          </summary>
          <div className="border-t border-border p-3">
            <ReportQueryDocs
              onUseExample={(query) => {
                setState((prev) => ({ ...prev, queryText: query }));
              }}
            />
          </div>
        </details>
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
