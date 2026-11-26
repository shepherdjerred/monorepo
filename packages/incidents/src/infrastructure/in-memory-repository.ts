import { isOpenStatus } from "#shared/contract.ts";
import { heldSystems } from "#domain/dedupe.ts";
import type { IncidentRecord, NewEvent } from "#domain/model.ts";
import {
  RevisionConflictError,
  SystemsTakenError,
  type ActorRecord,
  type IncidentFilter,
  type IncidentsRepository,
} from "#infrastructure/repository.ts";

/** Run synchronous work as a promise; a throw becomes a rejection. */
function run<T>(work: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(work());
  });
}

function matches(record: IncidentRecord, filter: IncidentFilter): boolean {
  const wanted =
    filter.state === "all" ||
    (filter.state === "open") === isOpenStatus(record.status);
  const kind = filter.kind === undefined || record.kind === filter.kind;
  const system =
    filter.system === undefined || record.systems.includes(filter.system);
  return wanted && kind && system;
}

/**
 * Same contract as the Prisma repository, held in process memory. Each
 * operation runs synchronously, so its compare-and-set is atomic exactly like
 * the conditional UPDATE it stands in for.
 */
export function createInMemoryIncidentsRepository(): IncidentsRepository {
  const actors = new Map<string, ActorRecord>();
  const incidents = new Map<string, IncidentRecord>();
  const events = new Map<string, NewEvent[]>();
  let nextNumber = 1;

  const claimSystems = (record: IncidentRecord) => {
    const taken = new Set<string>();
    for (const other of incidents.values())
      if (other.id !== record.id)
        for (const system of heldSystems(other)) taken.add(system);
    const clash = heldSystems(record).filter((system) => taken.has(system));
    if (clash.length > 0) throw new SystemsTakenError(clash);
  };

  const store = (record: IncidentRecord, added: readonly NewEvent[]) => {
    incidents.set(record.id, record);
    events.set(record.id, [...(events.get(record.id) ?? []), ...added]);
    return record;
  };

  const byKey = (key: string) =>
    [...actors.values()].find((actor) => actor.key === key) ?? null;

  return {
    ping: () => Promise.resolve(true),
    close: () => Promise.resolve(),

    upsertActor: (input, now) =>
      run(() => {
        const existing = byKey(input.key);
        const actor: ActorRecord = {
          id: existing?.id ?? crypto.randomUUID(),
          key: input.key,
          kind: input.kind,
          name: input.name,
          metadata: input.metadata ?? existing?.metadata ?? null,
          lastSeenAt: now,
        };
        actors.set(actor.id, actor);
        return actor;
      }),

    findActorByKey: (key) => run(() => byKey(key)),

    actorsById: (ids) =>
      run(
        () =>
          new Map(
            ids.flatMap((id) => {
              const actor = actors.get(id);
              return actor === undefined ? [] : [[id, actor] as const];
            }),
          ),
      ),

    findIncident: (lookup) =>
      run(() =>
        "id" in lookup
          ? (incidents.get(lookup.id) ?? null)
          : ([...incidents.values()].find(
              (record) => record.number === lookup.number,
            ) ?? null),
      ),

    listIncidents: (filter) =>
      run(() =>
        [...incidents.values()]
          .filter((record) => matches(record, filter))
          .sort((a, b) => b.declaredAt.getTime() - a.declaredAt.getTime())
          .slice(0, filter.limit),
      ),

    openIncidents: () =>
      run(() =>
        [...incidents.values()].filter((record) => isOpenStatus(record.status)),
      ),

    timeline: (incidentId) => run(() => [...(events.get(incidentId) ?? [])]),

    create: (transition) =>
      run(() => {
        claimSystems(transition.next);
        const record = { ...transition.next, number: nextNumber, revision: 0 };
        nextNumber += 1;
        return store(record, transition.events);
      }),

    commit: (previous, transition) =>
      run(() => {
        if (incidents.get(previous.id)?.revision !== previous.revision)
          throw new RevisionConflictError(previous.id);
        claimSystems(transition.next);
        return store(
          { ...transition.next, revision: previous.revision + 1 },
          transition.events,
        );
      }),
  };
}
