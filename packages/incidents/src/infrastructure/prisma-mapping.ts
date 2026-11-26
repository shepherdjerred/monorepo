/** Row ↔ domain mapping. Text enum columns are parsed with the contract's Zod enums. */
import { z } from "zod";
import {
  ActorKindSchema,
  ActorMetadataSchema,
  CommandStateSchema,
  IncidentEventTypeSchema,
  IncidentKindSchema,
  IncidentLinkKindSchema,
  IncidentSeveritySchema,
  IncidentSourceSchema,
  IncidentStatusSchema,
  IncidentSuspectSchema,
  IncidentSystemSchema,
} from "#shared/contract.ts";
import { Prisma } from "#generated/prisma/client.ts";
import type { IncidentRecord, JsonValue, NewEvent } from "#domain/model.ts";
import type { ActorRecord } from "#infrastructure/repository.ts";

export const INCIDENT_INCLUDE = {
  affected: { orderBy: { joinedAt: "asc" } },
  links: { orderBy: { createdAt: "asc" } },
  signals: { orderBy: { firstFiredAt: "asc" } },
} as const satisfies Prisma.IncidentInclude;

export type IncidentRow = Prisma.IncidentGetPayload<{
  include: typeof INCIDENT_INCLUDE;
}>;

const NullableSuspectSchema = IncidentSuspectSchema.nullable();
const NullableMetadataSchema = ActorMetadataSchema.nullable();
const EventDataSchema = z.record(z.string(), z.json()).nullable();

export function toIncidentRecord(row: IncidentRow): IncidentRecord {
  return {
    id: row.id,
    number: row.number,
    kind: IncidentKindSchema.parse(row.kind),
    title: row.title,
    summary: row.summary,
    impact: row.impact,
    severity: IncidentSeveritySchema.parse(row.severity),
    status: IncidentStatusSchema.parse(row.status),
    systems: row.systems.map((system) => IncidentSystemSchema.parse(system)),
    components: row.components,
    exitCondition: row.exitCondition,
    source: IncidentSourceSchema.parse(row.source),
    suspect: NullableSuspectSchema.parse(row.suspect),
    creatorId: row.creatorId,
    commandState: CommandStateSchema.parse(row.commandState),
    commanderId: row.commanderId,
    dispatcherId: row.dispatcherId,
    dispatchTokenHash: row.dispatchTokenHash,
    leaseExpiresAt: row.leaseExpiresAt,
    everClaimed: row.everClaimed,
    takeoverEligibleAt: row.takeoverEligibleAt,
    declaredAt: row.declaredAt,
    updatedAt: row.updatedAt,
    mitigatedAt: row.mitigatedAt,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    revision: row.revision,
    lastEventSeq: row.lastEventSeq,
    affected: row.affected.map((entry) => ({
      actorId: entry.actorId,
      joinedAt: entry.joinedAt,
    })),
    links: row.links.map((link) => ({
      id: link.id,
      kind: IncidentLinkKindSchema.parse(link.kind),
      ref: link.ref,
      url: link.url,
      title: link.title,
      createdAt: link.createdAt,
    })),
    signals: row.signals.map((signal) => ({
      key: signal.key,
      source: IncidentSourceSchema.parse(signal.source),
      title: signal.title,
      firing: signal.firing,
      firstFiredAt: signal.firstFiredAt,
      lastChangedAt: signal.lastChangedAt,
    })),
  };
}

export function toActorRecord(row: {
  id: string;
  key: string;
  kind: string;
  name: string;
  metadata: Prisma.JsonValue;
  lastSeenAt: Date;
}): ActorRecord {
  return {
    id: row.id,
    key: row.key,
    kind: ActorKindSchema.parse(row.kind),
    name: row.name,
    metadata: NullableMetadataSchema.parse(row.metadata),
    lastSeenAt: row.lastSeenAt,
  };
}

export function toEvent(row: {
  id: string;
  seq: number;
  type: string;
  actorId: string | null;
  body: string | null;
  data: Prisma.JsonValue;
  createdAt: Date;
}): NewEvent {
  return {
    id: row.id,
    seq: row.seq,
    type: IncidentEventTypeSchema.parse(row.type),
    actorId: row.actorId,
    body: row.body,
    data: EventDataSchema.parse(row.data),
    createdAt: row.createdAt,
  };
}

export function jsonOrDbNull(
  value: Readonly<Record<string, JsonValue>> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value ?? Prisma.DbNull;
}

/** Suspect as a JSON object (optional keys that are absent stay absent). */
export function suspectJson(
  suspect: IncidentRecord["suspect"],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return suspect === null
    ? Prisma.DbNull
    : Object.fromEntries(
        Object.entries(suspect).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, value]],
        ),
      );
}

/** Scalar columns a Transition may change. */
export function scalarColumns(record: IncidentRecord) {
  return {
    kind: record.kind,
    title: record.title,
    summary: record.summary,
    impact: record.impact,
    severity: record.severity,
    status: record.status,
    systems: [...record.systems],
    components: [...record.components],
    exitCondition: record.exitCondition,
    source: record.source,
    commandState: record.commandState,
    dispatchTokenHash: record.dispatchTokenHash,
    leaseExpiresAt: record.leaseExpiresAt,
    everClaimed: record.everClaimed,
    takeoverEligibleAt: record.takeoverEligibleAt,
    declaredAt: record.declaredAt,
    updatedAt: record.updatedAt,
    mitigatedAt: record.mitigatedAt,
    resolvedAt: record.resolvedAt,
    resolutionNote: record.resolutionNote,
    scheduledStart: record.scheduledStart,
    scheduledEnd: record.scheduledEnd,
    lastEventSeq: record.lastEventSeq,
  };
}
