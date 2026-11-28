import type {
  IncidentDetail,
  IncidentSummary,
  TakeCommandResult,
} from "@shepherdjerred/incidents/contract";
import { commandStateText, summaryLine } from "#lib/incidents/guidance.ts";
import { REDACTED } from "#lib/incidents/spawn.ts";

/** What every command prints: one JSON value or text, and the process exit code. */
export type IncidentResult = {
  readonly exitCode: number;
  readonly json: unknown;
  readonly text: string;
};

export function result(
  exitCode: number,
  json: unknown,
  text: string,
): IncidentResult {
  return { exitCode, json, text };
}

const TIMELINE_LIMIT = 12;

export function formatDetail(detail: IncidentDetail): string {
  const lines = [
    summaryLine(detail),
    `  revision ${String(detail.revision)} · declared ${detail.declaredAt}${detail.creator === null ? "" : ` by ${detail.creator.key}`} · source ${detail.source}`,
    ...(detail.kind === "maintenance" && detail.scheduledStart !== null
      ? [`  window ${detail.scheduledStart} → ${detail.scheduledEnd ?? "?"}`]
      : []),
    `  command: ${commandStateText(detail)}`,
    `  exit condition: ${detail.exitCondition}`,
    ...(detail.summary === "" ? [] : [`  summary: ${detail.summary}`]),
    ...(detail.impact === null ? [] : [`  impact: ${detail.impact}`]),
    ...(detail.suspect === null
      ? []
      : [`  suspect: ${JSON.stringify(detail.suspect)}`]),
    ...(detail.components.length === 0
      ? []
      : [`  components: ${detail.components.join(", ")}`]),
    ...detail.links.map(
      (link) =>
        `  link ${link.kind} ${link.ref}${link.title === undefined ? "" : ` — ${link.title}`}${link.url === undefined ? "" : ` ${link.url}`}`,
    ),
    ...(detail.affected.length === 0
      ? []
      : [
          `  affected: ${detail.affected.map((entry) => entry.actor.key).join(", ")}`,
        ]),
    ...detail.signals.map(
      (signal) =>
        `  signal ${signal.source} ${signal.key} ${signal.firing ? "firing" : "cleared"} — ${signal.title}`,
    ),
    ...(detail.resolutionNote === null
      ? []
      : [`  resolution: ${detail.resolutionNote}`]),
    "  timeline:",
    ...detail.timeline
      .slice(-TIMELINE_LIMIT)
      .map(
        (event) =>
          `    #${String(event.seq)} ${event.createdAt} ${event.type}${event.actor === null ? "" : ` (${event.actor.key})`}${event.body === null ? "" : `: ${event.body}`}`,
      ),
    `  ${detail.url}`,
  ];
  return lines.join("\n");
}

/** After a mutation: the record's state and the event the change appended. */
export function formatChange(detail: IncidentDetail): string {
  const last = detail.timeline.at(-1);
  const event =
    last === undefined
      ? ""
      : ` · #${String(last.seq)} ${last.type}${last.body === null ? "" : `: ${last.body}`}`;
  return `${summaryLine(detail)}\n  revision ${String(detail.revision)}${event}\n  ${detail.url}`;
}

export function formatList(incidents: readonly IncidentSummary[]): string {
  return incidents.length === 0
    ? "No incidents."
    : incidents.map((incident) => summaryLine(incident)).join("\n");
}

/** A take result safe to print: the dispatch token never leaves the spawn request. */
export function redactedTake(take: TakeCommandResult): unknown {
  return take.outcome === "dispatching"
    ? { ...take, dispatchToken: REDACTED }
    : take;
}
