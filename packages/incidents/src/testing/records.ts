/** Deterministic builders for unit tests. */
import {
  DeclareIncidentInputSchema,
  IncidentSignalInputSchema,
  type DeclareIncidentInput,
  type IncidentSignalInput,
} from "#shared/contract.ts";
import { declare, type DeclareFields } from "#domain/incident.ts";
import type {
  ActorRef,
  DomainContext,
  IncidentRecord,
  IncidentsSettings,
} from "#domain/model.ts";
import type { IncidentSignal } from "#domain/signals.ts";

export const T0 = new Date("2026-11-25T12:00:00.000Z");

export const SETTINGS: IncidentsSettings = {
  enabled: true,
  autoOpenAlertmanager: true,
  autoOpenMainCi: true,
  takeoverGraceSeconds: 600,
  dispatchLeaseSeconds: 600,
  takeoverSpawnEnabled: true,
  takeoverProvider: "claude-code",
};

export function actor(
  id: string,
  metadata: ActorRef["metadata"] = null,
): ActorRef {
  return { id, key: `agent:${id}`, kind: "agent", metadata };
}

export function minutes(n: number, from: Date = T0): Date {
  return new Date(from.getTime() + n * 60_000);
}

export function idSource(prefix = "id"): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

/** Unique across a test file, so separately built records never share an id. */
const sharedIds = idSource("rec");

export function contextAt(
  now: Date,
  who: ActorRef | null,
  newId: () => string = sharedIds,
): DomainContext {
  return { now, actor: who, newId };
}

export function declareFields(
  overrides: Partial<DeclareIncidentInput> = {},
): DeclareFields {
  const { actor: _actor, ...fields } = DeclareIncidentInputSchema.parse({
    actor: { key: "agent:test", kind: "agent", name: "test" },
    title: "Delivery dispatch is stuck",
    systems: ["delivery"],
    exitCondition: "Queued deployments dispatch again.",
    ...overrides,
  });
  return fields;
}

/** A persisted-looking record (number assigned) declared at `at` by `creator`. */
export function record(
  overrides: Partial<DeclareIncidentInput> = {},
  options: {
    creator?: ActorRef | null;
    at?: Date;
    number?: number;
    open?: readonly IncidentRecord[];
  } = {},
): IncidentRecord {
  const transition = declare(
    declareFields(overrides),
    contextAt(
      options.at ?? T0,
      options.creator === undefined ? actor("creator") : options.creator,
    ),
    {
      open: options.open ?? [],
      takeoverGraceSeconds: SETTINGS.takeoverGraceSeconds,
    },
  );
  return { ...transition.next, number: options.number ?? 1 };
}

export function signal(
  overrides: Partial<IncidentSignalInput> = {},
): IncidentSignal {
  return IncidentSignalInputSchema.parse({
    source: "main-ci",
    key: "main-ci:main",
    firing: true,
    system: "main-ci",
    severity: "sev2",
    title: "main is red",
    exitCondition: "main is green",
    observedAt: T0.toISOString(),
    ...overrides,
  });
}
