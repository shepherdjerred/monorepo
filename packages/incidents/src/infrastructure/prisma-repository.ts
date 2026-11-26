import { PrismaPg } from "@prisma/adapter-pg";
import {
  INCIDENT_STATUSES,
  IncidentSystemSchema,
  MAINTENANCE_STATUSES,
  TERMINAL_STATUSES,
} from "#shared/contract.ts";
import { PrismaClient, type Prisma } from "#generated/prisma/client.ts";
import { heldSystems } from "#domain/dedupe.ts";
import type { IncidentRecord, NewEvent } from "#domain/model.ts";
import {
  INCIDENT_INCLUDE,
  jsonOrDbNull,
  scalarColumns,
  suspectJson,
  toActorRecord,
  toEvent,
  toIncidentRecord,
} from "#infrastructure/prisma-mapping.ts";
import {
  RevisionConflictError,
  SystemsTakenError,
  type IncidentFilter,
  type IncidentsRepository,
} from "#infrastructure/repository.ts";

type Tx = Prisma.TransactionClient;

const OPEN_STATUSES = [...INCIDENT_STATUSES, ...MAINTENANCE_STATUSES].filter(
  (status) => !TERMINAL_STATUSES.has(status),
);
const CLOSED_STATUSES = [...TERMINAL_STATUSES];
const TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 15_000 } as const;

export function createIncidentsDatabase(
  connectionString: string,
): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Claim the systems `record` holds; `ON CONFLICT DO NOTHING` waits out a concurrent claimer. */
async function claimSystems(tx: Tx, record: IncidentRecord): Promise<void> {
  await tx.openIncidentSystem.deleteMany({ where: { incidentId: record.id } });
  const systems = heldSystems(record);
  if (systems.length === 0) return;
  const claimed = await tx.openIncidentSystem.createMany({
    data: systems.map((system) => ({ system, incidentId: record.id })),
    skipDuplicates: true,
  });
  if (claimed.count === systems.length) return;
  const holders = await tx.openIncidentSystem.findMany({
    where: { system: { in: systems }, incidentId: { not: record.id } },
  });
  throw new SystemsTakenError(
    holders.map((row) => IncidentSystemSchema.parse(row.system)),
  );
}

async function insertEvents(
  tx: Tx,
  incidentId: string,
  events: readonly NewEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await tx.incidentEvent.createMany({
    data: events.map((event) => ({
      id: event.id,
      incidentId,
      seq: event.seq,
      type: event.type,
      actorId: event.actorId,
      body: event.body,
      data: jsonOrDbNull(event.data),
      createdAt: event.createdAt,
    })),
  });
}

/** Write the collection rows that differ between `previous` and `next`. */
async function syncCollections(
  tx: Tx,
  previous: IncidentRecord | null,
  next: IncidentRecord,
): Promise<void> {
  const knownLinks = new Set(previous?.links.map((link) => link.id));
  const newLinks = next.links.filter((link) => !knownLinks.has(link.id));
  if (newLinks.length > 0)
    await tx.incidentLink.createMany({
      data: newLinks.map((link) => ({ ...link, incidentId: next.id })),
    });

  const before = new Set(previous?.affected.map((entry) => entry.actorId));
  const after = new Set(next.affected.map((entry) => entry.actorId));
  const joined = next.affected.filter((entry) => !before.has(entry.actorId));
  const left = [...before].filter((actorId) => !after.has(actorId));
  if (joined.length > 0)
    await tx.incidentAffected.createMany({
      data: joined.map((entry) => ({ ...entry, incidentId: next.id })),
    });
  if (left.length > 0)
    await tx.incidentAffected.deleteMany({
      where: { incidentId: next.id, actorId: { in: left } },
    });

  for (const signal of next.signals) {
    const prior = previous?.signals.find((entry) => entry.key === signal.key);
    if (
      prior?.firing === signal.firing &&
      prior.lastChangedAt.getTime() === signal.lastChangedAt.getTime() &&
      prior.title === signal.title
    )
      continue;
    await tx.incidentSignal.upsert({
      where: { incidentId_key: { incidentId: next.id, key: signal.key } },
      create: { ...signal, incidentId: next.id },
      update: {
        title: signal.title,
        firing: signal.firing,
        firstFiredAt: signal.firstFiredAt,
        lastChangedAt: signal.lastChangedAt,
      },
    });
  }
}

function listWhere(filter: IncidentFilter): Prisma.IncidentWhereInput {
  return {
    ...(filter.state === "open" ? { status: { in: OPEN_STATUSES } } : {}),
    ...(filter.state === "resolved" ? { status: { in: CLOSED_STATUSES } } : {}),
    ...(filter.kind === undefined ? {} : { kind: filter.kind }),
    ...(filter.system === undefined ? {} : { systems: { has: filter.system } }),
  };
}

export function createPrismaIncidentsRepository(
  prisma: PrismaClient,
): IncidentsRepository {
  const load = async (where: Prisma.IncidentWhereUniqueInput) => {
    const row = await prisma.incident.findUnique({
      where,
      include: INCIDENT_INCLUDE,
    });
    return row === null ? null : toIncidentRecord(row);
  };

  return {
    ping: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },

    close: async () => {
      await prisma.$disconnect();
    },

    upsertActor: async (input, now) => {
      const metadata = input.metadata ?? undefined;
      const row = await prisma.actor.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          kind: input.kind,
          name: input.name,
          ...(metadata === undefined ? {} : { metadata }),
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          kind: input.kind,
          name: input.name,
          ...(metadata === undefined ? {} : { metadata }),
          lastSeenAt: now,
          seenCount: { increment: 1 },
        },
      });
      return toActorRecord(row);
    },

    findActorByKey: async (key) => {
      const row = await prisma.actor.findUnique({ where: { key } });
      return row === null ? null : toActorRecord(row);
    },

    actorsById: async (ids) => {
      if (ids.length === 0) return new Map();
      const rows = await prisma.actor.findMany({
        where: { id: { in: [...new Set(ids)] } },
      });
      return new Map(rows.map((row) => [row.id, toActorRecord(row)]));
    },

    findIncident: async (lookup) =>
      "id" in lookup
        ? load({ id: lookup.id })
        : load({ number: lookup.number }),

    listIncidents: async (filter) => {
      const rows = await prisma.incident.findMany({
        where: listWhere(filter),
        include: INCIDENT_INCLUDE,
        orderBy: { declaredAt: "desc" },
        take: filter.limit,
      });
      return rows.map((row) => toIncidentRecord(row));
    },

    openIncidents: async () => {
      const rows = await prisma.incident.findMany({
        where: { status: { in: OPEN_STATUSES } },
        include: INCIDENT_INCLUDE,
        orderBy: { declaredAt: "desc" },
      });
      return rows.map((row) => toIncidentRecord(row));
    },

    timeline: async (incidentId) => {
      const rows = await prisma.incidentEvent.findMany({
        where: { incidentId },
        orderBy: { seq: "asc" },
      });
      return rows.map((row) => toEvent(row));
    },

    create: async (transition) => {
      const next = transition.next;
      const number = await prisma.$transaction(async (tx) => {
        const row = await tx.incident.create({
          data: {
            id: next.id,
            ...scalarColumns(next),
            suspect: suspectJson(next.suspect),
            creatorId: next.creatorId,
            commanderId: next.commanderId,
            dispatcherId: next.dispatcherId,
            revision: 0,
          },
          select: { number: true },
        });
        await claimSystems(tx, next);
        await insertEvents(tx, next.id, transition.events);
        await syncCollections(tx, null, next);
        return row.number;
      }, TRANSACTION_OPTIONS);
      return { ...next, number, revision: 0 };
    },

    commit: async (previous, transition) => {
      const next = transition.next;
      await prisma.$transaction(async (tx) => {
        // The compare-and-set: exactly one writer per read revision commits.
        const updated = await tx.incident.updateMany({
          where: { id: previous.id, revision: previous.revision },
          data: {
            ...scalarColumns(next),
            suspect: suspectJson(next.suspect),
            commanderId: next.commanderId,
            dispatcherId: next.dispatcherId,
            revision: previous.revision + 1,
          },
        });
        if (updated.count !== 1) throw new RevisionConflictError(previous.id);
        await claimSystems(tx, next);
        await insertEvents(tx, next.id, transition.events);
        await syncCollections(tx, previous, next);
      }, TRANSACTION_OPTIONS);
      return { ...next, revision: previous.revision + 1 };
    },
  };
}
