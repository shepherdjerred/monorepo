/**
 * What a blocked agent should do next about an open incident, as one exact
 * command. Shared by `toolkit incident check`, `wait`, and the red-main
 * sections of `toolkit ci`.
 */
import type { z } from "zod";
import type {
  CheckIncidentsResult,
  IncidentRelationSchema,
  IncidentSummary,
} from "@shepherdjerred/incidents/contract";

export type IncidentRelation = z.infer<typeof IncidentRelationSchema>;
export type CheckedIncident = CheckIncidentsResult["incidents"][number];

/** Scheduled maintenance has not started, so it blocks nobody yet. */
export function isBlocking(incident: IncidentSummary): boolean {
  return incident.status !== "scheduled";
}

export function commandStateText(incident: IncidentSummary): string {
  const { command } = incident;
  if (command.state === "owned")
    return `owned by ${command.commander?.key ?? "unknown"}`;
  return command.state === "dispatching"
    ? `dispatching (lease until ${command.leaseExpiresAt ?? "?"})`
    : `unowned (takeover eligible ${command.takeoverEligibleAt})`;
}

export function relationText(relation: IncidentRelation): string {
  const parts = (
    ["commander", "suspect", "creator", "affected", "canTake"] as const
  ).filter((key) => relation[key]);
  return parts.length === 0 ? "none" : parts.join(", ");
}

/**
 * The caller likely caused it and nobody else is fixing it, so it should take
 * command instead of waiting. A suspect whose incident another agent already
 * commands waits like anyone else (and can help through updates).
 */
export function shouldTake(entry: CheckedIncident): boolean {
  return (
    entry.relation.suspect &&
    !entry.relation.commander &&
    entry.incident.command.state !== "owned"
  );
}

/** The one command this caller should run next for `incident`. */
export function nextCommand(entry: CheckedIncident): string {
  const id = entry.incident.identifier;
  if (entry.relation.commander)
    return `toolkit incident update ${id} --body "<progress>"`;
  if (shouldTake(entry)) return `toolkit incident take ${id}`;
  return isBlocking(entry.incident)
    ? `toolkit incident wait ${id}`
    : `toolkit incident view ${id}`;
}

/** One sentence for the caller: why the next command is the right one. */
export function nextStep(entry: CheckedIncident): string {
  const id = entry.incident.identifier;
  const command = nextCommand(entry);
  if (entry.relation.commander)
    return `You are commander of ${id}; post progress: ${command}`;
  if (shouldTake(entry)) return `You likely caused ${id} — take it: ${command}`;
  return isBlocking(entry.incident)
    ? `Blocked by ${id}; wait for it (joins as affected, takes over if nobody does): ${command}`
    : `${id} is scheduled maintenance: ${command}`;
}

export function declareCommand(system = "<system>"): string {
  return `toolkit incident declare --system ${system} --severity sev2 --title "<what is broken>" --exit-condition "<observable recovery>"`;
}

export function nothingOpenText(system: string | undefined): string {
  return system === undefined
    ? `Nothing open. If a shared system is broken, declare it: ${declareCommand()}`
    : `Nothing open for ${system} — if ${system} is broken, declare it: ${declareCommand(system)}`;
}

export function summaryLine(incident: IncidentSummary): string {
  return `${incident.identifier} ${incident.severity} ${incident.kind === "maintenance" ? "maintenance " : ""}${incident.status} [${incident.systems.join(", ")}] ${incident.title} — ${commandStateText(incident)}, ${String(incident.affectedCount)} affected`;
}
