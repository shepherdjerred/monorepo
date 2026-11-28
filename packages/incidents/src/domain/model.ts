/**
 * The incident aggregate as the domain sees it. Persistence maps rows to this
 * shape; the server maps it to the wire read models. Every domain operation is
 * a pure function from a record (plus injected time, ids, and settings) to the
 * next record and the timeline events that explain the change.
 */
import type {
  ActorKind,
  ActorMetadata,
  CommandState,
  IncidentEventType,
  IncidentKind,
  IncidentLinkKind,
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  IncidentSuspect,
  IncidentSystem,
} from "#shared/contract.ts";

export type ActorRef = {
  readonly id: string;
  readonly key: string;
  readonly kind: ActorKind;
  readonly metadata: ActorMetadata | null;
};

export type AffectedEntry = {
  readonly actorId: string;
  readonly joinedAt: Date;
};

export type LinkEntry = {
  readonly id: string;
  readonly kind: IncidentLinkKind;
  readonly ref: string;
  readonly url: string | null;
  readonly title: string | null;
  readonly createdAt: Date;
};

export type SignalEntry = {
  readonly key: string;
  readonly source: IncidentSource;
  readonly title: string;
  readonly firing: boolean;
  readonly firstFiredAt: Date;
  readonly lastChangedAt: Date;
};

export type IncidentRecord = {
  readonly id: string;
  /** 0 until the repository draws the next `INC-N` number on create. */
  readonly number: number;
  readonly kind: IncidentKind;
  readonly title: string;
  readonly summary: string;
  readonly impact: string | null;
  readonly severity: IncidentSeverity;
  readonly status: IncidentStatus;
  readonly systems: readonly IncidentSystem[];
  readonly components: readonly string[];
  readonly exitCondition: string;
  readonly source: IncidentSource;
  readonly suspect: IncidentSuspect | null;
  readonly creatorId: string | null;
  readonly commandState: CommandState;
  readonly commanderId: string | null;
  readonly dispatcherId: string | null;
  readonly dispatchTokenHash: string | null;
  readonly leaseExpiresAt: Date | null;
  /** Someone has held command at least once; blocks signal auto-resolve. */
  readonly everClaimed: boolean;
  readonly takeoverEligibleAt: Date;
  readonly declaredAt: Date;
  readonly updatedAt: Date;
  readonly mitigatedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly resolutionNote: string | null;
  readonly scheduledStart: Date | null;
  readonly scheduledEnd: Date | null;
  readonly revision: number;
  readonly lastEventSeq: number;
  readonly affected: readonly AffectedEntry[];
  readonly links: readonly LinkEntry[];
  readonly signals: readonly SignalEntry[];
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type EventData = Readonly<Record<string, JsonValue>>;

export type NewEvent = {
  readonly id: string;
  readonly seq: number;
  readonly type: IncidentEventType;
  readonly actorId: string | null;
  readonly body: string | null;
  readonly data: EventData | null;
  readonly createdAt: Date;
};

/** A domain decision: the next record and the events explaining it. No events means no change. */
export type Transition = {
  readonly next: IncidentRecord;
  readonly events: readonly NewEvent[];
};

/** Behavior read from feature flags for one request. */
export type IncidentsSettings = {
  readonly enabled: boolean;
  readonly autoOpenAlertmanager: boolean;
  readonly autoOpenMainCi: boolean;
  readonly takeoverGraceSeconds: number;
  readonly dispatchLeaseSeconds: number;
  readonly takeoverSpawnEnabled: boolean;
  readonly takeoverProvider: string;
};

export type DomainContext = {
  readonly now: Date;
  readonly newId: () => string;
  /** Null for system-originated changes (lease expiry, signals without an actor). */
  readonly actor: ActorRef | null;
};

export function begin(record: IncidentRecord): Transition {
  return { next: record, events: [] };
}

export function patch(
  transition: Transition,
  fields: Partial<IncidentRecord>,
): Transition {
  return { next: { ...transition.next, ...fields }, events: transition.events };
}

export type EventSpec = {
  readonly type: IncidentEventType;
  readonly body?: string | null;
  readonly data?: EventData | null;
  /** Override the context actor (system events pass null). */
  readonly actorId?: string | null;
};

/** Append one timeline event; sequence numbers continue from the record. */
export function emit(
  transition: Transition,
  context: DomainContext,
  spec: EventSpec,
): Transition {
  const seq = transition.next.lastEventSeq + 1;
  const event: NewEvent = {
    id: context.newId(),
    seq,
    type: spec.type,
    actorId:
      spec.actorId === undefined ? (context.actor?.id ?? null) : spec.actorId,
    body: spec.body ?? null,
    data: spec.data ?? null,
    createdAt: context.now,
  };
  return {
    next: { ...transition.next, lastEventSeq: seq, updatedAt: context.now },
    events: [...transition.events, event],
  };
}

export function requireActor(context: DomainContext): ActorRef {
  if (context.actor === null)
    throw new Error("This incident command requires an actor");
  return context.actor;
}

const SEVERITY_RANK: Readonly<Record<IncidentSeverity, number>> = {
  sev1: 1,
  sev2: 2,
  sev3: 3,
};

/** True when `candidate` is more severe than `current` (sev1 is the most severe). */
export function isMoreSevere(
  candidate: IncidentSeverity,
  current: IncidentSeverity,
): boolean {
  return SEVERITY_RANK[candidate] < SEVERITY_RANK[current];
}

/**
 * Open-listing priority: most severe first, then newest declaration. The
 * severity names sort lexically in rank order (`sev1` < `sev2` < `sev3`),
 * which lets PostgreSQL apply the same order with a plain `ORDER BY`.
 */
export function compareOpenPriority(
  a: Pick<IncidentRecord, "severity" | "declaredAt">,
  b: Pick<IncidentRecord, "severity" | "declaredAt">,
): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  return bySeverity === 0
    ? b.declaredAt.getTime() - a.declaredAt.getTime()
    : bySeverity;
}

export function incidentLabel(record: IncidentRecord): string {
  return record.number > 0 ? `INC-${String(record.number)}` : "this incident";
}
