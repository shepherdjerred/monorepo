/**
 * The load → decide → commit loop every command shares. Decisions are pure
 * domain functions; this module supplies time, ids, the acting actor and the
 * open-incident set, commits with the repository's compare-and-set, and
 * publishes one stream frame per commit.
 */
import {
  incidentIdentifier,
  parseIncidentNumber,
  type ActorInput,
  type DuplicateIncident,
  type IncidentDetail,
  type IncidentSummary,
} from "#shared/contract.ts";
import { findOverlap } from "#domain/dedupe.ts";
import {
  duplicateIncident,
  IncidentError,
  staleRevision,
  type IncidentConflictDetail,
} from "#domain/errors.ts";
import type {
  ActorRef,
  DomainContext,
  IncidentRecord,
  IncidentsSettings,
  Transition,
} from "#domain/model.ts";
import type { IncidentsFlagReader } from "#infrastructure/flags.ts";
import {
  RevisionConflictError,
  SystemsTakenError,
  type ActorRecord,
  type IncidentLookup,
  type IncidentsRepository,
  type SignalWrite,
} from "#infrastructure/repository.ts";
import type { IncidentEventBus } from "#server/event-bus.ts";
import {
  actorIdsOf,
  presentAt,
  toDetail,
  toSummary,
} from "#server/read-model.ts";

/** Commands without `expectedRevision` re-decide this many times under contention. */
const MAX_ATTEMPTS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export type ServiceOptions = {
  readonly repository: IncidentsRepository;
  readonly flags: IncidentsFlagReader;
  readonly bus: IncidentEventBus;
  readonly publicOrigin: string;
  readonly clock: () => Date;
  readonly newId: () => string;
  readonly newToken: () => string;
};

export function actorRef(actor: ActorRecord): ActorRef {
  return {
    id: actor.id,
    key: actor.key,
    kind: actor.kind,
    metadata: actor.metadata,
  };
}

export function lookupFor(ref: string): IncidentLookup {
  const number = parseIncidentNumber(ref);
  if (number !== null) return { number };
  if (UUID.test(ref)) return { id: ref.toLowerCase() };
  throw new IncidentError(
    "BAD_REQUEST",
    `"${ref}" is not an incident reference (use INC-N, N, or an id)`,
  );
}

export type Decide<T> = (
  record: IncidentRecord,
  context: DomainContext,
  open: readonly IncidentRecord[],
  settings: IncidentsSettings,
) => { readonly transition: Transition; readonly result: T };

export type MutateRequest<T> = {
  readonly ref: string;
  readonly actor: ActorInput;
  /** Stale revisions are refused, never retried. */
  readonly expectedRevision?: number;
  /** Load the open set (dedupe-sensitive commands). */
  readonly needsOpen?: boolean;
  readonly decide: Decide<T>;
};

export function createServiceCore(options: ServiceOptions) {
  const { repository } = options;

  const readContext = async (
    records: readonly IncidentRecord[],
    events: Parameters<typeof actorIdsOf>[1] = [],
  ) => ({
    publicOrigin: options.publicOrigin,
    actors: await repository.actorsById(actorIdsOf(records, events)),
  });

  const summaries = async (
    records: readonly IncidentRecord[],
  ): Promise<IncidentSummary[]> => {
    const now = options.clock();
    const presented = records.map((record) => presentAt(record, now));
    const context = await readContext(presented);
    return presented.map((record) => toSummary(record, context));
  };

  const detail = async (record: IncidentRecord): Promise<IncidentDetail> => {
    const presented = presentAt(record, options.clock());
    const events = await repository.timeline(record.id);
    return toDetail(presented, events, await readContext([presented], events));
  };

  const load = async (ref: string): Promise<IncidentRecord> => {
    const record = await repository.findIncident(lookupFor(ref));
    if (record === null)
      throw new IncidentError("NOT_FOUND", `No incident ${ref}`);
    return record;
  };

  const settings = async (): Promise<IncidentsSettings> => options.flags.read();

  const requireEnabled = async (): Promise<IncidentsSettings> => {
    const current = await settings();
    if (!current.enabled)
      throw new IncidentError(
        "FORBIDDEN",
        "Incident writes are disabled (alert-dashboard-incidents-enabled)",
      );
    return current;
  };

  const domainContext = (actor: ActorRef | null): DomainContext => ({
    now: options.clock(),
    newId: options.newId,
    actor,
  });

  const publish = (record: IncidentRecord, transition: Transition) => {
    const last = transition.events.at(-1);
    if (last === undefined) return;
    options.bus.publish({
      incidentId: record.id,
      identifier: incidentIdentifier(record.number),
      revision: record.revision,
      type: last.type,
      status: record.status,
      commandState: record.commandState,
    });
  };

  /** Turn a lost dedupe race into the caller-facing duplicate conflict. */
  const duplicateFrom = async (
    error: SystemsTakenError,
    candidate: IncidentRecord,
  ): Promise<IncidentError | null> => {
    const open = await repository.openIncidents();
    const overlap = findOverlap(candidate, open, candidate.id);
    return overlap === null
      ? null
      : duplicateIncident(
          overlap.existing,
          error.systems.length > 0 ? error.systems : overlap.systems,
        );
  };

  const commitOrCreate = async (
    previous: IncidentRecord | null,
    transition: Transition,
  ): Promise<IncidentRecord> => {
    const committed =
      previous === null
        ? await repository.create(transition)
        : await repository.commit(previous, transition);
    publish(committed, transition);
    return committed;
  };

  /** Commit a signal's watermark and incident write together; publish the incident change. */
  const commitSignal = async (
    write: SignalWrite,
  ): Promise<IncidentRecord | null> => {
    const committed = await repository.commitSignal(write);
    if (committed !== null && write.incident !== null)
      publish(committed, write.incident.transition);
    return committed;
  };

  /** After a failed commit: throw the caller-facing error, or return to re-decide. */
  const afterFailedCommit = async (
    error: unknown,
    request: MutateRequest<unknown>,
    candidate: IncidentRecord,
  ): Promise<void> => {
    if (error instanceof SystemsTakenError) {
      const duplicate = await duplicateFrom(error, candidate);
      if (duplicate !== null) throw duplicate;
      return;
    }
    if (!(error instanceof RevisionConflictError)) throw error;
    if (request.expectedRevision !== undefined)
      throw staleRevision(await load(request.ref), request.expectedRevision);
  };

  const loadAtRevision = async (request: MutateRequest<unknown>) => {
    const record = await load(request.ref);
    const expected = request.expectedRevision;
    if (expected !== undefined && record.revision !== expected)
      throw staleRevision(record, expected);
    return record;
  };

  const mutate = async <T>(
    request: MutateRequest<T>,
  ): Promise<{ record: IncidentRecord; result: T; actor: ActorRecord }> => {
    const current = await requireEnabled();
    const actor = await repository.upsertActor(request.actor, options.clock());
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const record = await loadAtRevision(request);
      const open =
        request.needsOpen === true ? await repository.openIncidents() : [];
      const { transition, result } = request.decide(
        record,
        domainContext(actorRef(actor)),
        open,
        current,
      );
      if (transition.events.length === 0) return { record, result, actor };
      try {
        const committed = await commitOrCreate(record, transition);
        return { record: committed, result, actor };
      } catch (error: unknown) {
        await afterFailedCommit(error, request, transition.next);
      }
    }
    throw new IncidentError(
      "CONFLICT",
      `${request.ref} is changing too fast to apply this command; retry`,
    );
  };

  const conflictPayload = async (
    conflict: IncidentConflictDetail,
  ): Promise<
    | DuplicateIncident
    | {
        code: "stale-revision";
        expectedRevision: number;
        incident: IncidentSummary;
      }
  > => {
    if (conflict.kind === "duplicate") {
      const [existing] = await summaries([conflict.existing]);
      if (existing === undefined) throw new Error("summary missing");
      return {
        code: "duplicate-incident",
        existing,
        systems: [...conflict.systems],
      };
    }
    const [incident] = await summaries([conflict.current]);
    if (incident === undefined) throw new Error("summary missing");
    return {
      code: "stale-revision",
      expectedRevision: conflict.expectedRevision,
      incident,
    };
  };

  return {
    options,
    repository,
    settings,
    requireEnabled,
    domainContext,
    load,
    mutate,
    commitOrCreate,
    commitSignal,
    duplicateFrom,
    summaries,
    detail,
    conflictPayload,
  };
}

export type ServiceCore = ReturnType<typeof createServiceCore>;
