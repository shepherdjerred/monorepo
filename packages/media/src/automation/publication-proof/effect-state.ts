import { createHash } from "node:crypto";
import {
  FileOperationConflict,
  ManifestSchema,
} from "#filesystem/operations-types.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { PublicationIntentRef } from "#shared/publication-proof/intent.ts";
import {
  PublicationEffectSchema,
  type PublicationEffect,
  type PhysicalPathState,
  type PublicationJournal,
  type PublicationEffectRef,
  type PublicationPath,
} from "#shared/publication-proof/effects.ts";
import type { PublicationStep } from "./steps.ts";

const equal = (left: unknown, right: unknown) =>
  snapshotHash(nativeJson(left)) === snapshotHash(nativeJson(right));
export const physicalKey = (
  kind: string,
  item: Pick<PhysicalPathState, "root" | "path">,
) => JSON.stringify([kind, item.root, item.path]);
export const effectHash = (effect: PublicationEffect) =>
  createHash("sha256").update(JSON.stringify(effect)).digest("hex");

/** Pure causal validation only. Its data cannot authorize IO without a fresh content capability. */
export class PublicationEffectState {
  readonly physical = new Map<string, PhysicalPathState>();
  readonly journals = new Map<string, PublicationJournal>();
  readonly refs: PublicationEffectRef[] = [];
  private previousHash: string | null = null;
  private readonly planned: PublicationStep[];
  constructor(
    readonly intent: PublicationIntentRef,
    steps: readonly PublicationStep[],
  ) {
    this.planned = [...steps];
    for (const item of intent.intent.entries) {
      for (const participant of item.participants) {
        const key = physicalKey(participant.libraryKind, participant.physical);
        const previous = this.physical.get(key);
        if (previous !== undefined && !equal(previous, participant.physical))
          throw new Error("Intent contains conflicting path states");
        this.physical.set(key, participant.physical);
      }
      for (const journal of item.journals)
        this.journals.set(
          JSON.stringify([item.entry.libraryKind, journal.path]),
          journal,
        );
    }
  }

  get next(): PublicationStep | undefined {
    return this.planned[this.refs.length];
  }

  record(event: PublicationEffect["effect"]): PublicationEffect {
    const step = this.next;
    if (step === undefined)
      throw new FileOperationConflict(
        "Publication effect exceeds its exact plan",
      );
    return PublicationEffectSchema.parse({
      schemaVersion: 1,
      transitionId: this.intent.transitionId,
      continuationId: step.continuationId ?? null,
      intentHash: this.intent.intentHash,
      ordinal: this.refs.length,
      previousEffectHash: this.previousHash,
      entryOperationId: step.entryOperationId,
      assetId: step.assetId,
      subtitleId: step.subtitleId,
      libraryKind: step.libraryKind,
      effect: event,
    });
  }

  validate(record: PublicationEffect): void {
    const candidate = new PublicationEffectState(this.intent, this.planned);
    candidate.physical.clear();
    for (const [key, value] of this.physical)
      candidate.physical.set(key, value);
    candidate.journals.clear();
    for (const [key, value] of this.journals)
      candidate.journals.set(key, value);
    candidate.refs.push(...this.refs);
    candidate.previousHash = this.previousHash;
    candidate.accept(record);
  }

  replaceRemaining(steps: readonly PublicationStep[]): void {
    this.planned.splice(
      this.refs.length,
      this.planned.length - this.refs.length,
      ...steps,
    );
  }

  accept(record: PublicationEffect): void {
    const step = this.next;
    if (
      step === undefined ||
      !equal(record, this.record(record.effect)) ||
      record.effect.operationId !== step.operationId ||
      record.effect.step !== step.step ||
      record.effect.primitive !== step.primitive
    )
      throw new FileOperationConflict(
        "Publication effect chain does not match its exact plan",
      );
    const event = record.effect;
    const journalKey = JSON.stringify([step.libraryKind, event.journal.path]);
    const previousJournal = this.journals.get(journalKey);
    if (event.primitive === "journal_complete") {
      if (
        previousJournal === undefined ||
        !equal(previousJournal, event.beforeJournal) ||
        !equal(ManifestSchema.parse(JSON.parse(event.journal.raw)), {
          ...step.manifest,
          phase: "complete",
        }) ||
        !equal(
          event.beforeJournal.identity.ancestors,
          event.journal.identity.ancestors,
        )
      )
        throw new FileOperationConflict(
          "Publication journal completion lacks its actual predecessor",
        );
      this.requireStates(
        step.libraryKind,
        event.participants,
        this.completionPaths(step),
      );
    } else {
      if (
        !equal(event.source, step.source) ||
        !equal(event.target, step.target) ||
        !equal(
          ManifestSchema.parse(JSON.parse(event.journal.raw)),
          step.manifest,
        ) ||
        (previousJournal !== undefined &&
          !equal(previousJournal, event.journal))
      )
        throw new FileOperationConflict(
          "Publication primitive descriptor changed",
        );
      this.requireStates(
        step.libraryKind,
        event.before,
        event.target === null ? [event.source] : [event.source, event.target],
      );
      validateMutation(event);
      for (const state of event.after)
        this.physical.set(physicalKey(step.libraryKind, state), state);
    }
    this.journals.set(journalKey, event.journal);
    const hash = effectHash(record);
    this.refs.push({
      ordinal: record.ordinal,
      libraryKind: record.libraryKind,
      effectHash: hash,
      operationId: event.operationId,
      step: event.step,
    });
    this.previousHash = hash;
  }

  private completionPaths(step: PublicationStep): PublicationPath[] {
    if (step.completionPaths !== undefined) return [...step.completionPaths];
    const item = this.intent.intent.entries.find(
      ({ entry }) => entry.operationId === step.entryOperationId,
    );
    if (item === undefined) throw new Error("Completion entry missing");
    const sidecar = item.entry.previousSidecars.find(
      (row) => row.operationId === step.operationId,
    );
    if (sidecar !== undefined)
      return [
        { root: "library", path: sidecar.libraryPath },
        { root: "control", path: `quarantine/${sidecar.quarantineId}` },
      ];
    return [
      { root: "library", path: item.entry.libraryPath },
      { root: "control", path: `staging/${step.operationId}` },
      { root: "control", path: `rollback/${step.operationId}` },
    ];
  }

  private requireStates(
    kind: string,
    states: readonly PhysicalPathState[],
    paths: readonly PublicationPath[],
  ) {
    const keys = states.map((item) => physicalKey(kind, item));
    const expected = new Set(paths.map((item) => physicalKey(kind, item)));
    const identities = new Set(
      [...expected].flatMap((key) => {
        const state = this.physical.get(key);
        return state?.state === "present"
          ? [JSON.stringify([state.identity.device, state.identity.inode])]
          : [];
      }),
    );
    for (const [key, state] of this.physical)
      if (
        key.startsWith(JSON.stringify([kind]).slice(0, -1) + ",") &&
        state.state === "present" &&
        identities.has(
          JSON.stringify([state.identity.device, state.identity.inode]),
        )
      )
        expected.add(key);
    if (
      new Set(keys).size !== keys.length ||
      keys.length !== expected.size ||
      keys.some((key) => !expected.has(key)) ||
      states.some((item) => {
        const prior = this.physical.get(physicalKey(kind, item));
        return prior === undefined || !equal(prior, item);
      })
    )
      throw new FileOperationConflict(
        "Publication path state is not its causal predecessor",
      );
  }
}

function validateMutation(
  event: Exclude<
    PublicationEffect["effect"],
    { primitive: "journal_complete" }
  >,
) {
  const before = new Map(
    event.before.map((item) => [physicalKey("", item), item]),
  );
  const after = new Map(
    event.after.map((item) => [physicalKey("", item), item]),
  );
  const sourceKey = physicalKey("", event.source);
  const source = before.get(sourceKey);
  const targetKey =
    event.target === null ? null : physicalKey("", event.target);
  if (
    source?.state !== "present" ||
    before.size !== event.before.length ||
    after.size !== event.after.length ||
    before.size !== after.size ||
    [...before.keys()].some((key) => !after.has(key))
  )
    throw new FileOperationConflict(
      "Publication mutation has incomplete physical states",
    );
  if (
    event.primitive === "link" &&
    (targetKey === null || before.get(targetKey)?.state !== "absent")
  )
    throw new FileOperationConflict(
      "Publication link did not begin with exact absence",
    );
  for (const [key, prior] of before) {
    const next = after.get(key);
    if (next === undefined) throw new Error("Validated after set disappeared");
    validatePathTransition(prior, next, {
      removed: key === sourceKey && event.primitive !== "link",
      expected: key === targetKey ? source : prior,
    });
  }
}

function validatePathTransition(
  prior: PhysicalPathState,
  next: PhysicalPathState,
  mutation: { removed: boolean; expected: PhysicalPathState },
) {
  if (
    !equal(
      prior.state === "present" ? prior.identity.ancestors : prior.ancestors,
      next.state === "present" ? next.identity.ancestors : next.ancestors,
    )
  )
    throw new FileOperationConflict(
      "Publication mutation changed a path ancestor",
    );
  if (mutation.removed) {
    if (
      next.state !== "absent" ||
      !equal(
        next.ancestors,
        prior.state === "present" ? prior.identity.ancestors : prior.ancestors,
      )
    )
      throw new FileOperationConflict(
        "Publication source removal lacks exact absence",
      );
  } else {
    if (!sameContentIdentity(mutation.expected, next))
      throw new FileOperationConflict(
        "Publication after state changed content identity",
      );
  }
}

function sameContentIdentity(
  left: PhysicalPathState,
  right: PhysicalPathState,
) {
  return left.state === "absent" || right.state === "absent"
    ? equal(left, right)
    : left.sha256 === right.sha256 &&
        left.sizeBytes === right.sizeBytes &&
        left.identity.device === right.identity.device &&
        left.identity.inode === right.identity.inode &&
        left.identity.mtimeNs === right.identity.mtimeNs;
}
