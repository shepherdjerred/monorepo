/**
 * Contract-valid read models for the client tests. They are parsed with the
 * shared schemas, so a fixture that drifts from the wire contract fails here
 * rather than passing a test against a shape the server never sends.
 */
import {
  IncidentDetailSchema,
  type Actor,
  type Command,
  type IncidentDetail,
  type IncidentSummary,
} from "#shared/contract.ts";

export const NOW_MS = Date.parse("2026-11-25T12:00:00.000Z");

export function at(minutes: number): string {
  return new Date(NOW_MS + minutes * 60_000).toISOString();
}

export function actorRecord(
  key: string,
  overrides: Partial<Actor> = {},
): Actor {
  const [prefix = "agent"] = key.split(":");
  return {
    id: `actor-${key}`,
    key,
    kind: prefix === "human" ? "human" : "agent",
    name: prefix === "human" ? "Jerred" : prefix,
    metadata: null,
    lastSeenAt: at(-1),
    ...overrides,
  };
}

export const FIXER = actorRecord("claude-code:fixer", {
  metadata: { branch: "temporal-schedule-split" },
});
export const VIEWER_KEY = "human:browser";

export function unowned(eligibleInMinutes: number): Command {
  return {
    state: "none",
    commander: null,
    dispatcher: null,
    leaseExpiresAt: null,
    takeoverEligibleAt: at(eligibleInMinutes),
  };
}

export function owned(commander: Actor): Command {
  return { ...unowned(-5), state: "owned", commander };
}

export function dispatching(leaseMinutes: number): Command {
  return {
    ...unowned(-5),
    state: "dispatching",
    dispatcher: actorRecord("codex:waiter", {
      metadata: { branch: "media-acquisition" },
    }),
    leaseExpiresAt: at(leaseMinutes),
  };
}

export function detail(
  overrides: Partial<IncidentDetail> = {},
): IncidentDetail {
  const number = overrides.number ?? 4;
  return IncidentDetailSchema.parse({
    id: `incident-${String(number)}`,
    number,
    identifier: `INC-${String(number)}`,
    kind: "incident",
    title: "temporal-workers holds the Delivery dispatch barrier",
    severity: "sev1",
    status: "investigating",
    systems: ["delivery"],
    components: ["temporal-workers"],
    source: "manual",
    command: unowned(-5),
    affectedCount: 0,
    firingSignals: 0,
    declaredAt: at(-25),
    updatedAt: at(-4),
    resolvedAt: null,
    scheduledStart: null,
    scheduledEnd: null,
    revision: 3,
    url: `https://hub.example.ts.net/incidents/INC-${String(number)}`,
    summary: "Every Delivery claim answers BUSY.",
    impact: null,
    exitCondition: "Queued deployments dispatch.",
    suspect: null,
    creator: actorRecord("system:alertmanager", {
      kind: "system",
      name: "Alertmanager",
    }),
    resolutionNote: null,
    mitigatedAt: null,
    affected: [],
    links: [],
    signals: [],
    timeline: [
      {
        id: "event-1",
        seq: 1,
        type: "declared",
        actor: null,
        body: "Every Delivery claim answers BUSY.",
        data: { kind: "incident", severity: "sev1", systems: ["delivery"] },
        createdAt: at(-25),
      },
    ],
    ...overrides,
  });
}

export function summary(
  overrides: Partial<IncidentDetail> = {},
): IncidentSummary {
  const {
    summary: _summary,
    impact: _impact,
    exitCondition: _exit,
    suspect: _suspect,
    creator: _creator,
    resolutionNote: _note,
    mitigatedAt: _mitigated,
    affected: _affected,
    links: _links,
    signals: _signals,
    timeline: _timeline,
    ...rest
  } = detail(overrides);
  return rest;
}
