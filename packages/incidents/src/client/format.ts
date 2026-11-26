/**
 * Pure presentation rules for the incident pages: labels, ordering, the
 * command-state sentence, and the actions the viewer is offered. Everything
 * here is a function of contract data and an instant, so it is unit-tested
 * without rendering.
 */
import type { Severity } from "@shepherdjerred/console-ui";
import {
  INCIDENT_SYSTEM_LABELS,
  isOpenStatus,
  type Actor,
  type ActorInput,
  type Command,
  type IncidentDetail,
  type IncidentEventType,
  type IncidentKind,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentSummary,
  type IncidentSystem,
} from "#shared/contract.ts";
import {
  canMove,
  reopenTarget,
  resolveTarget,
  STATUS_MOVES,
} from "#shared/lifecycle.ts";

export const SEVERITY_TONE: Readonly<Record<IncidentSeverity, Severity>> = {
  sev1: "error",
  sev2: "warning",
  sev3: "info",
};

export const SEVERITY_LABEL: Readonly<Record<IncidentSeverity, string>> = {
  sev1: "SEV1",
  sev2: "SEV2",
  sev3: "SEV3",
};

export const SEVERITY_HINT: Readonly<Record<IncidentSeverity, string>> = {
  sev1: "Shared system down; nothing ships",
  sev2: "Degraded; work is blocked or late",
  sev3: "Minor; a workaround exists",
};

const SEVERITY_RANK: Readonly<Record<IncidentSeverity, number>> = {
  sev1: 0,
  sev2: 1,
  sev3: 2,
};

export const STATUS_LABEL: Readonly<Record<IncidentStatus, string>> = {
  investigating: "Investigating",
  identified: "Identified",
  mitigating: "Mitigating",
  monitoring: "Monitoring",
  resolved: "Resolved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  verifying: "Verifying",
  completed: "Completed",
  canceled: "Canceled",
};

export const KIND_LABEL: Readonly<Record<IncidentKind, string>> = {
  incident: "Incident",
  maintenance: "Maintenance",
};

export const EVENT_LABEL: Readonly<Record<IncidentEventType, string>> = {
  declared: "Declared",
  update: "Update",
  "status-changed": "Status changed",
  "severity-changed": "Severity changed",
  edited: "Edited",
  claimed: "Took command",
  dispatched: "Dispatching a commander",
  "dispatch-expired": "Dispatch lease expired",
  "handed-off": "Handed off",
  released: "Released command",
  joined: "Joined as affected",
  left: "Left",
  "link-added": "Link added",
  "signal-firing": "Signal firing",
  "signal-cleared": "Signal cleared",
  resolved: "Resolved",
  reopened: "Reopened",
};

export function statusTone(status: IncidentStatus): Severity {
  if (status === "resolved" || status === "completed") return "ok";
  if (status === "canceled" || status === "scheduled") return "unknown";
  return status === "monitoring" || status === "verifying" ? "info" : "warning";
}

export function systemLabel(system: IncidentSystem): string {
  return INCIDENT_SYSTEM_LABELS[system];
}

/** People and systems by name; agents by harness and branch, since many agents share a name. */
export function actorLabel(actor: Actor | ActorInput): string {
  if (actor.kind === "human" || actor.kind === "system") return actor.name;
  const branch = actor.metadata?.branch;
  if (branch !== undefined) return `${actor.name} · ${branch}`;
  const suffix = actor.key.slice(actor.key.indexOf(":") + 1);
  return `${actor.name} · ${suffix.length > 12 ? `${suffix.slice(0, 12)}…` : suffix}`;
}

const MINUTE_MS = 60_000;

/** `45s`, `12m`, `3h 05m`, `2d 4h` — the span between two instants. */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${String(total)}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`
    : `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

export function formatAge(iso: string, nowMs: number): string {
  return formatSpan(nowMs - Date.parse(iso));
}

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const STAMP = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Time of day when the instant is within a day of now, else date and time. */
export function formatInstant(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  return Math.abs(at - nowMs) < 24 * 60 * MINUTE_MS
    ? CLOCK.format(at)
    : STAMP.format(at);
}

export type CommandView = {
  /** `unowned` is maintenance without an owner: it has no takeover grace. */
  readonly state: "owned" | "dispatching" | "eligible" | "waiting" | "unowned";
  readonly tone: Severity;
  readonly label: string;
  readonly detail: string | null;
};

/**
 * The one-line answer to "who is handling this?" at `nowMs`. Takeover and
 * dispatch exist for broken shared systems, so maintenance reads only as
 * "Owner: X" or "No owner", never in eligibility terms.
 */
export function describeCommand(
  command: Command,
  nowMs: number,
  kind: IncidentKind,
): CommandView {
  if (command.state === "owned" && command.commander !== null)
    return {
      state: "owned",
      tone: "ok",
      label:
        kind === "maintenance"
          ? `Owner: ${actorLabel(command.commander)}`
          : `Owned by ${actorLabel(command.commander)}`,
      detail: command.commander.key,
    };
  if (command.state === "dispatching" && command.leaseExpiresAt !== null)
    return {
      state: "dispatching",
      tone: "info",
      label: `Dispatching to new session until ${formatInstant(command.leaseExpiresAt, nowMs)}`,
      detail:
        command.dispatcher === null
          ? null
          : `Lease held by ${actorLabel(command.dispatcher)}; ${formatSpan(Date.parse(command.leaseExpiresAt) - nowMs)} left`,
    };
  if (kind === "maintenance")
    return {
      state: "unowned",
      tone: "unknown",
      label: "No owner",
      detail: null,
    };
  const eligibleAt = Date.parse(command.takeoverEligibleAt);
  if (eligibleAt <= nowMs)
    return {
      state: "eligible",
      tone: "warning",
      label: "Unowned — takeover eligible now",
      detail: "Any agent or person may take command.",
    };
  return {
    state: "waiting",
    tone: "unknown",
    label: `Unowned — takeover eligible at ${formatInstant(command.takeoverEligibleAt, nowMs)}`,
    detail: `Until then only the creator or the suspect is expected to take it (${formatSpan(eligibleAt - nowMs)}).`,
  };
}

/** Open first, then most severe, then newest — the order `check` uses. */
export function compareIncidents(a: IncidentSummary, b: IncidentSummary) {
  const open = Number(isOpenStatus(b.status)) - Number(isOpenStatus(a.status));
  if (open !== 0) return open;
  const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  return severity === 0
    ? Date.parse(b.declaredAt) - Date.parse(a.declaredAt)
    : severity;
}

export function sortIncidents(
  incidents: readonly IncidentSummary[],
): IncidentSummary[] {
  return [...incidents].sort(compareIncidents);
}

/** Statuses `changeStatus` accepts from the current one, in lifecycle order. */
export function statusMoves(
  kind: IncidentKind,
  status: IncidentStatus,
): IncidentStatus[] {
  return STATUS_MOVES[status].filter((to) => canMove(kind, status, to));
}

export type CommandActions = {
  readonly isCommander: boolean;
  /** `take` without force would be accepted now. */
  readonly canTake: boolean;
  /** `take` needs `force`: not yet eligible, or someone else holds command or the lease. */
  readonly canForce: boolean;
  readonly canRelease: boolean;
  readonly canResolve: boolean;
  readonly canReopen: boolean;
};

/** Which command actions to offer `viewerKey` at `nowMs`. */
export function commandActions(
  incident: Pick<
    IncidentDetail,
    "command" | "creator" | "kind" | "status" | "suspect"
  >,
  viewerKey: string,
  nowMs: number,
): CommandActions {
  const open = isOpenStatus(incident.status);
  const { command } = incident;
  const isCommander =
    command.state === "owned" && command.commander?.key === viewerKey;
  const view = describeCommand(command, nowMs, incident.kind);
  const isCreator = incident.creator?.key === viewerKey;
  // Mirrors the domain's `mayTakeNow`: maintenance has no takeover grace.
  const canTake =
    open &&
    (view.state === "eligible" ||
      view.state === "unowned" ||
      (view.state === "waiting" && isCreator));
  return {
    isCommander,
    canTake,
    canForce: open && !isCommander && !canTake,
    canRelease: open && isCommander,
    canResolve: open && resolveTarget(incident.kind, incident.status) !== null,
    canReopen: reopenTarget(incident.status) !== null,
  };
}

/** `Resolve` for incidents, `Complete` for maintenance. */
export function resolveVerb(kind: IncidentKind): string {
  return kind === "incident" ? "Resolve" : "Complete";
}

type EventData = Readonly<Record<string, unknown>>;

function field(data: EventData, key: string): string | null {
  const value = data[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function transition(data: EventData): string | null {
  const from = field(data, "from");
  const to = field(data, "to");
  return from === null || to === null ? null : `${from} → ${to}`;
}

function forced(data: EventData): string | null {
  return data["forced"] === true
    ? `Forced, overriding ${field(data, "overrode") ?? "the takeover grace"}`
    : null;
}

const EVENT_DETAIL: Partial<
  Record<IncidentEventType, (data: EventData) => string | null>
> = {
  "status-changed": transition,
  "severity-changed": transition,
  reopened: transition,
  claimed: forced,
  dispatched: forced,
  "handed-off": (data) => {
    const to = field(data, "toKey");
    return to === null ? null : `To ${to}`;
  },
  resolved: (data) => {
    if (data["auto"] === true) return "Every attached signal cleared";
    return data["forced"] === true ? "Forced by a non-commander" : null;
  },
  "signal-firing": (data) => field(data, "key"),
  "signal-cleared": (data) => field(data, "key"),
  "link-added": (data) => {
    const kind = field(data, "kind");
    const ref = field(data, "ref");
    return kind === null || ref === null ? null : `${kind} ${ref}`;
  },
};

/** The one-line timeline summary of an event's structured data. */
export function eventDetail(
  type: IncidentEventType,
  data: EventData | null,
): string | null {
  const describe = EVENT_DETAIL[type];
  return data === null || describe === undefined ? null : describe(data);
}
