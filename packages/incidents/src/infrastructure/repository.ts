/**
 * Persistence port. Both implementations (PostgreSQL via Prisma, and the
 * in-memory one used by unit tests and Hub's fixture mode) give the same
 * guarantees:
 *
 * - `commit` applies a Transition only when the stored revision still equals
 *   the revision it was decided against (one conditional UPDATE), otherwise
 *   it throws `RevisionConflictError` and changes nothing.
 * - `create` and `commit` claim every system an open incident holds; a system
 *   another open incident holds throws `SystemsTakenError`.
 * - `commitSignal` advances a signal's observation watermark with the same
 *   compare-and-set, atomically with the signal's incident write.
 */
import type {
  ActorInput,
  ActorKind,
  ActorMetadata,
  IncidentKind,
  IncidentSystem,
} from "#shared/contract.ts";
import type { IncidentRecord, NewEvent, Transition } from "#domain/model.ts";
import type { SignalObservation, SignalWatermark } from "#domain/watermark.ts";

export type ActorRecord = {
  readonly id: string;
  readonly key: string;
  readonly kind: ActorKind;
  readonly name: string;
  readonly metadata: ActorMetadata | null;
  readonly lastSeenAt: Date;
};

export type IncidentFilter = {
  readonly state: "open" | "resolved" | "all";
  readonly kind?: IncidentKind | undefined;
  readonly system?: IncidentSystem | undefined;
  readonly limit: number;
};

export type IncidentLookup =
  { readonly number: number } | { readonly id: string };

export class RevisionConflictError extends Error {
  override readonly name = "RevisionConflictError";

  /** `subject` names what moved: an incident id, or `signal <source>/<key>`. */
  constructor(readonly subject: string) {
    super(`${subject} changed since it was read`);
  }
}

export class SystemsTakenError extends Error {
  override readonly name = "SystemsTakenError";

  constructor(readonly systems: readonly IncidentSystem[]) {
    super(`Another open incident holds ${systems.join(", ")}`);
  }
}

export type IncidentsRepository = {
  readonly ping: () => Promise<boolean>;
  readonly close: () => Promise<void>;
  /** Insert or refresh an actor by its stable key (same rule as Tracker). */
  readonly upsertActor: (input: ActorInput, now: Date) => Promise<ActorRecord>;
  readonly findActorByKey: (key: string) => Promise<ActorRecord | null>;
  readonly actorsById: (
    ids: readonly string[],
  ) => Promise<ReadonlyMap<string, ActorRecord>>;
  readonly findIncident: (
    lookup: IncidentLookup,
  ) => Promise<IncidentRecord | null>;
  /**
   * Open listings: most severe first, then newest (`compareOpenPriority`),
   * applied before `limit`. Other states: newest first by declaration.
   */
  readonly listIncidents: (filter: IncidentFilter) => Promise<IncidentRecord[]>;
  /** Every non-terminal record, for dedupe and signal targeting. */
  readonly openIncidents: () => Promise<IncidentRecord[]>;
  readonly timeline: (incidentId: string) => Promise<NewEvent[]>;
  /** Persist a declared record, drawing its `INC-N` number. */
  readonly create: (transition: Transition) => Promise<IncidentRecord>;
  /** Persist a Transition decided against `previous` (CAS on `previous.revision`). */
  readonly commit: (
    previous: IncidentRecord,
    transition: Transition,
  ) => Promise<IncidentRecord>;
  readonly findSignalWatermark: (
    source: SignalObservation["source"],
    key: string,
  ) => Promise<SignalWatermark | null>;
  /**
   * Advance a signal's watermark (CAS on `previous.revision`, or insert when
   * `previous` is null) and apply its incident write, if any, in one
   * transaction. Either conflict throws `RevisionConflictError` (or
   * `SystemsTakenError`) and writes nothing.
   */
  readonly commitSignal: (write: SignalWrite) => Promise<IncidentRecord | null>;
};

export type SignalWrite = {
  readonly watermark: {
    readonly previous: SignalWatermark | null;
    readonly next: SignalObservation;
  };
  /** `previous: null` creates the record. */
  readonly incident: {
    readonly previous: IncidentRecord | null;
    readonly transition: Transition;
  } | null;
};
