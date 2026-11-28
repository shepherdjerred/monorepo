/** Domain records → wire read models (`IncidentSummary`, `IncidentDetail`). */
import {
  incidentIdentifier,
  type Actor,
  type IncidentDetail,
  type IncidentSummary,
} from "#shared/contract.ts";
import { expireLease } from "#domain/command.ts";
import { begin, type IncidentRecord, type NewEvent } from "#domain/model.ts";
import type { ActorRecord } from "#infrastructure/repository.ts";

export const DEFAULT_PUBLIC_ORIGIN = "https://hub.tailnet-1a49.ts.net";

/**
 * The record as readers should see it at `now`: a lapsed dispatch lease reads
 * as unowned. The lapse is persisted (with its timeline event) by the next
 * write, so reads never write and never move `revision`.
 */
export function presentAt(record: IncidentRecord, now: Date): IncidentRecord {
  return expireLease(begin(record), {
    now,
    actor: null,
    newId: () => "presented",
  }).next;
}

export function actorIdsOf(
  records: readonly IncidentRecord[],
  events: readonly NewEvent[] = [],
): string[] {
  const ids = new Set<string>();
  for (const record of records) {
    for (const id of [
      record.creatorId,
      record.commanderId,
      record.dispatcherId,
    ])
      if (id !== null) ids.add(id);
    for (const entry of record.affected) ids.add(entry.actorId);
  }
  for (const event of events)
    if (event.actorId !== null) ids.add(event.actorId);
  return [...ids];
}

function toActor(record: ActorRecord): Actor {
  return {
    id: record.id,
    key: record.key,
    kind: record.kind,
    name: record.name,
    metadata: record.metadata,
    lastSeenAt: record.lastSeenAt.toISOString(),
  };
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export type ReadModelContext = {
  readonly publicOrigin: string;
  readonly actors: ReadonlyMap<string, ActorRecord>;
};

function requiredActor(id: string, context: ReadModelContext): Actor {
  const actor = context.actors.get(id);
  if (actor === undefined)
    throw new Error(`Actor ${id} is referenced but missing`);
  return toActor(actor);
}

function actorOf(id: string | null, context: ReadModelContext): Actor | null {
  return id === null ? null : requiredActor(id, context);
}

export function incidentUrl(publicOrigin: string, number: number): string {
  return new URL(
    `/incidents/${incidentIdentifier(number)}`,
    publicOrigin,
  ).toString();
}

export function toSummary(
  record: IncidentRecord,
  context: ReadModelContext,
): IncidentSummary {
  return {
    id: record.id,
    number: record.number,
    identifier: incidentIdentifier(record.number),
    kind: record.kind,
    title: record.title,
    severity: record.severity,
    status: record.status,
    systems: [...record.systems],
    components: [...record.components],
    source: record.source,
    command: {
      state: record.commandState,
      commander: actorOf(record.commanderId, context),
      dispatcher: actorOf(record.dispatcherId, context),
      leaseExpiresAt: iso(record.leaseExpiresAt),
      takeoverEligibleAt: record.takeoverEligibleAt.toISOString(),
    },
    affectedCount: record.affected.length,
    firingSignals: record.signals.filter((signal) => signal.firing).length,
    declaredAt: record.declaredAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    resolvedAt: iso(record.resolvedAt),
    scheduledStart: iso(record.scheduledStart),
    scheduledEnd: iso(record.scheduledEnd),
    revision: record.revision,
    url: incidentUrl(context.publicOrigin, record.number),
  };
}

export function toDetail(
  record: IncidentRecord,
  events: readonly NewEvent[],
  context: ReadModelContext,
): IncidentDetail {
  return {
    ...toSummary(record, context),
    summary: record.summary,
    impact: record.impact,
    exitCondition: record.exitCondition,
    suspect: record.suspect,
    creator: actorOf(record.creatorId, context),
    resolutionNote: record.resolutionNote,
    mitigatedAt: iso(record.mitigatedAt),
    affected: record.affected.map((entry) => ({
      actor: requiredActor(entry.actorId, context),
      joinedAt: entry.joinedAt.toISOString(),
    })),
    links: record.links.map((link) => ({
      id: link.id,
      kind: link.kind,
      ref: link.ref,
      ...(link.url === null ? {} : { url: link.url }),
      ...(link.title === null ? {} : { title: link.title }),
      createdAt: link.createdAt.toISOString(),
    })),
    signals: record.signals.map((signal) => ({
      key: signal.key,
      source: signal.source,
      title: signal.title,
      firing: signal.firing,
      firstFiredAt: signal.firstFiredAt.toISOString(),
      lastChangedAt: signal.lastChangedAt.toISOString(),
    })),
    timeline: events.map((event) => ({
      id: event.id,
      seq: event.seq,
      type: event.type,
      actor: actorOf(event.actorId, context),
      body: event.body,
      data: event.data === null ? null : { ...event.data },
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
