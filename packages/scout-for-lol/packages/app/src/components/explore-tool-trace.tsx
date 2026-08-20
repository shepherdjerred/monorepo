import { Check, CircleStop, LoaderCircle, X } from "lucide-react";
import type {
  ExploreTraceDetails,
  ExploreTraceEntry,
  ExploreTraceRawValue,
  ExploreTraceStatus,
} from "@scout-for-lol/data";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";

export function ExploreToolTrace(props: {
  trace: ExploreTraceEntry[];
  showRaw: boolean;
  live?: boolean;
}) {
  return (
    <ol
      className="space-y-2"
      aria-label={props.live === true ? "Live tool steps" : "Tool steps"}
    >
      {props.trace.map((entry, index) => (
        <ToolStep
          key={`${entry.toolCallId}-${String(index)}`}
          entry={entry}
          showRaw={props.showRaw}
        />
      ))}
    </ol>
  );
}

function ToolStep(props: { entry: ExploreTraceEntry; showRaw: boolean }) {
  const { entry } = props;
  return (
    <li className="rounded-md border border-scout-border bg-scout-surface p-3 text-xs">
      <div className="flex items-start gap-2">
        <StatusIcon status={entry.status} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{toolLabel(entry.toolName)}</span>
            <span className="text-scout-subtle">
              {statusLabel(entry.status)}
              {entry.durationMs === null
                ? ""
                : ` · ${formatDuration(entry.durationMs)}`}
            </span>
          </div>
          <p className="text-scout-subtle">{entry.message}</p>
        </div>
      </div>

      {entry.details !== null && (
        <div className="mt-3 border-t border-scout-border pt-3">
          <CuratedDetails details={entry.details} />
        </div>
      )}

      {props.showRaw &&
        (entry.rawInput !== null || entry.rawOutput !== null) && (
          <details className="mt-3 border-t border-scout-border pt-2">
            <summary className="cursor-pointer font-medium text-scout-subtle">
              Raw JSON
            </summary>
            <div className="mt-2 space-y-3">
              {entry.rawInput !== null && (
                <RawPayload label="Input" payload={entry.rawInput} />
              )}
              {entry.rawOutput !== null && (
                <RawPayload label="Output" payload={entry.rawOutput} />
              )}
            </div>
          </details>
        )}
    </li>
  );
}

function CuratedDetails(props: { details: ExploreTraceDetails }) {
  const details = props.details;
  if (details.kind === "reference") {
    const counts = [
      ["Sources", details.sources],
      ["Metrics", details.metrics],
      ["Functions", details.functions],
      ["Groupings", details.groupBys],
      ["Filters", details.filters],
      ["Render kinds", details.renderKinds],
      ["Render options", details.renderOptions],
      ["Queues", details.queues],
      ["Presets", details.presets],
    ];
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {counts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt className="text-scout-subtle">{label}</dt>
            <dd className="font-medium tabular-nums">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (details.kind === "validation") {
    return (
      <div className="space-y-2">
        <ScoutQlCode queryText={details.queryText} />
        {details.ok !== null && (
          <p
            className={details.ok ? "text-scout-success" : "text-scout-danger"}
          >
            {details.ok ? "Valid ScoutQL" : "Invalid ScoutQL"}
          </p>
        )}
        {details.diagnostics.length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-scout-danger">
            {details.diagnostics.map((diagnostic) => (
              <li key={diagnostic}>{diagnostic}</li>
            ))}
          </ul>
        )}
        {details.formattedQueryText !== null &&
          details.formattedQueryText !== details.queryText && (
            <LabeledQuery
              label="Formatted"
              queryText={details.formattedQueryText}
            />
          )}
      </div>
    );
  }
  if (details.kind === "format") {
    return (
      <div className="space-y-2">
        <LabeledQuery label="Input" queryText={details.queryText} />
        {details.formattedQueryText !== null && (
          <LabeledQuery
            label="Formatted"
            queryText={details.formattedQueryText}
          />
        )}
      </div>
    );
  }
  return <ExecutionDetails details={details} />;
}

function ExecutionDetails(props: {
  details: Extract<ExploreTraceDetails, { kind: "execution" }>;
}) {
  const details = props.details;
  return (
    <div className="space-y-2">
      <ScoutQlCode queryText={details.queryText} />
      {(details.rowsReturned !== null ||
        details.rowsScanned !== null ||
        details.renderKind !== null) && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-scout-subtle">
          {details.rowsReturned !== null && (
            <div>
              <dt className="inline">Rows returned: </dt>
              <dd className="inline font-medium text-scout-ink">
                {details.rowsReturned}
              </dd>
            </div>
          )}
          {details.rowsScanned !== null && (
            <div>
              <dt className="inline">Rows scanned: </dt>
              <dd className="inline font-medium text-scout-ink">
                {details.rowsScanned}
              </dd>
            </div>
          )}
          {details.renderKind !== null && (
            <div>
              <dt className="inline">Render: </dt>
              <dd className="inline font-medium text-scout-ink">
                {details.renderKind}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function LabeledQuery(props: { label: string; queryText: string }) {
  return (
    <div className="space-y-1">
      <p className="font-medium text-scout-subtle">{props.label}</p>
      <ScoutQlCode queryText={props.queryText} />
    </div>
  );
}

function RawPayload(props: { label: string; payload: ExploreTraceRawValue }) {
  return (
    <div className="space-y-1">
      <p className="font-medium">{props.label}</p>
      {props.payload.kind === "value" ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-scout-hover/50 p-3 font-mono text-xs">
          {JSON.stringify(props.payload.value, null, 2)}
        </pre>
      ) : (
        <p className="rounded-md bg-scout-hover/50 p-3 text-scout-subtle">
          Omitted because this {formatBytes(props.payload.byteLength)} payload
          exceeded the{" "}
          {props.payload.reason === "payload_limit"
            ? "per-payload"
            : "per-turn"}{" "}
          inspection limit.
        </p>
      )}
    </div>
  );
}

function StatusIcon(props: { status: ExploreTraceStatus }) {
  const className = "mt-0.5 size-4 shrink-0";
  if (props.status === "running") {
    return (
      <LoaderCircle
        className={`${className} animate-spin text-scout-brand`}
        aria-label="Running"
      />
    );
  }
  if (props.status === "succeeded") {
    return (
      <Check className={`${className} text-scout-success`} aria-label="Done" />
    );
  }
  if (props.status === "failed") {
    return (
      <X className={`${className} text-scout-danger`} aria-label="Failed" />
    );
  }
  return (
    <CircleStop
      className={`${className} text-scout-subtle`}
      aria-label="Interrupted"
    />
  );
}

function toolLabel(toolName: string): string {
  if (toolName === "get_report_language") {
    return "Read ScoutQL reference";
  }
  if (toolName === "validate_report_query") {
    return "Validate ScoutQL";
  }
  if (toolName === "format_report_query") {
    return "Format ScoutQL";
  }
  if (toolName === "run_report_query") {
    return "Run ScoutQL";
  }
  return toolName;
}

function statusLabel(status: ExploreTraceStatus): string {
  if (status === "running") {
    return "Running";
  }
  if (status === "succeeded") {
    return "Completed";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Interrupted";
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs.toString()} ms`
    : `${(durationMs / 1000).toFixed(1)} s`;
}

function formatBytes(byteLength: number): string {
  return byteLength < 1024
    ? `${byteLength.toString()} B`
    : `${(byteLength / 1024).toFixed(1)} KiB`;
}
