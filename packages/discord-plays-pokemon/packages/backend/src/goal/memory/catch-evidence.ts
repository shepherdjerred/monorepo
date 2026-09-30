import type { GameSnapshot } from "#src/game/events/types.ts";
import { SPECIES_TO_NATIONAL } from "#src/game/events/generated/species.ts";

export type PartyIdentityEvidence = {
  personality: number;
  otId: number;
  species: number;
};

export type CatchStateEvidence = {
  party: readonly PartyIdentityEvidence[];
  dexOwned: Uint8Array;
};

export type CatchEventEvidence = {
  occurredAt: string;
  frame: number;
  species: number;
  nationalDexNumber: number;
  postEventParty: readonly PartyIdentityEvidence[];
  postEventNationalDexOwned: boolean;
};

export const CATCH_EVIDENCE_SETTLE_MAX_FRAMES = 1800;
export const CATCH_EVIDENCE_SETTLE_MAX_MS = 30_000;
export const POST_PROCESS_CATCH_SIGNAL_GRACE_MAX_FRAMES = 600;
export const POST_PROCESS_CATCH_SIGNAL_GRACE_MAX_MS = 10_000;
export const POST_PROCESS_CATCH_OBSERVATION_HARD_MAX_MS =
  POST_PROCESS_CATCH_SIGNAL_GRACE_MAX_MS + CATCH_EVIDENCE_SETTLE_MAX_MS + 1000;

export type CatchSignal = {
  occurredAt: string;
  species: number;
};

export type CatchEvidenceSample = {
  frame: number;
  capturedAtMs: number;
  snapshot: GameSnapshot | null;
  catches: readonly CatchSignal[];
};

type PendingCatch = {
  occurredAt: string;
  frame: number;
  species: number;
  nationalDexNumber: number;
  deadlineFrame: number;
  deadlineAtMs: number;
};

export type CatchEvidenceSettler = {
  observe: (sample: CatchEvidenceSample) => void;
  pendingCount: () => number;
  finish: () => readonly CatchEventEvidence[];
};

export type PostProcessCatchObservation = {
  processEndedFrame: number;
  processEndedAtMs: number;
  observedFrame: number;
  observedAtMs: number;
  pendingCount: number;
};

export function shouldContinuePostProcessCatchObservation(
  observation: PostProcessCatchObservation,
): boolean {
  validatePostProcessObservation(observation);
  if (
    observation.observedAtMs >=
    observation.processEndedAtMs + POST_PROCESS_CATCH_OBSERVATION_HARD_MAX_MS
  ) {
    return false;
  }
  const signalGraceActive =
    observation.observedFrame <=
      observation.processEndedFrame +
        POST_PROCESS_CATCH_SIGNAL_GRACE_MAX_FRAMES &&
    observation.observedAtMs <=
      observation.processEndedAtMs + POST_PROCESS_CATCH_SIGNAL_GRACE_MAX_MS;
  return signalGraceActive || observation.pendingCount > 0;
}

export function createCatchEvidenceSettler(
  initialSnapshot: GameSnapshot,
): CatchEvidenceSettler {
  let lastFrame = -1;
  let lastCapturedAtMs = -1;
  let previousSnapshot = initialSnapshot;
  let pending: PendingCatch[] = [];
  const captured: CatchEventEvidence[] = [];

  function capture(
    event: PendingCatch,
    snapshot: GameSnapshot,
  ): CatchEventEvidence {
    return {
      occurredAt: event.occurredAt,
      frame: event.frame,
      species: event.species,
      nationalDexNumber: event.nationalDexNumber,
      postEventParty: snapshot.party.map((mon) => ({
        personality: mon.personality,
        otId: mon.otId,
        species: mon.species,
      })),
      postEventNationalDexOwned: dexOwned(snapshot, event.nationalDexNumber),
    };
  }

  function observe(sample: CatchEvidenceSample): void {
    validateSample(sample, lastFrame, lastCapturedAtMs);
    lastFrame = sample.frame;
    lastCapturedAtMs = sample.capturedAtMs;

    if (sample.catches.length > 0 && pending.length > 0) {
      captured.push(
        ...pending.map((event) => capture(event, previousSnapshot)),
      );
      pending = [];
    }

    for (const signal of sample.catches) {
      const event: PendingCatch = {
        occurredAt: signal.occurredAt,
        frame: sample.frame,
        species: signal.species,
        nationalDexNumber: nationalDexNumber(signal.species),
        deadlineFrame: sample.frame + CATCH_EVIDENCE_SETTLE_MAX_FRAMES,
        deadlineAtMs: sample.capturedAtMs + CATCH_EVIDENCE_SETTLE_MAX_MS,
      };
      if (
        sample.snapshot !== null &&
        snapshotContainsSpeciesDelta(
          initialSnapshot,
          sample.snapshot,
          event.species,
          event.nationalDexNumber,
        )
      ) {
        captured.push(capture(event, sample.snapshot));
      } else {
        pending.push(event);
      }
    }

    if (sample.catches.length === 0) {
      const stillPending: PendingCatch[] = [];
      for (const event of pending) {
        const withinWindow =
          sample.frame <= event.deadlineFrame &&
          sample.capturedAtMs <= event.deadlineAtMs;
        if (withinWindow) {
          if (
            sample.snapshot !== null &&
            snapshotContainsSpeciesDelta(
              initialSnapshot,
              sample.snapshot,
              event.species,
              event.nationalDexNumber,
            )
          ) {
            captured.push(capture(event, sample.snapshot));
          } else {
            stillPending.push(event);
          }
        } else {
          captured.push(capture(event, previousSnapshot));
        }
      }
      pending = stillPending;
    }

    if (sample.snapshot !== null) {
      previousSnapshot = sample.snapshot;
    }
  }

  return {
    observe,
    pendingCount(): number {
      return pending.length;
    },
    finish(): readonly CatchEventEvidence[] {
      captured.push(
        ...pending.map((event) => capture(event, previousSnapshot)),
      );
      pending = [];
      return [...captured];
    },
  };
}

function validateSample(
  sample: CatchEvidenceSample,
  lastFrame: number,
  lastCapturedAtMs: number,
): void {
  if (!Number.isInteger(sample.frame) || sample.frame < 0) {
    throw new Error(
      "catch evidence sample frame must be a nonnegative integer",
    );
  }
  if (!Number.isFinite(sample.capturedAtMs) || sample.capturedAtMs < 0) {
    throw new Error(
      "catch evidence sample time must be a nonnegative finite number",
    );
  }
  if (sample.frame < lastFrame) {
    throw new Error("catch evidence sample frames must be monotonic");
  }
  if (sample.capturedAtMs < lastCapturedAtMs) {
    throw new Error("catch evidence sample times must be monotonic");
  }
}

function validatePostProcessObservation(
  observation: PostProcessCatchObservation,
): void {
  for (const [field, value] of [
    ["processEndedFrame", observation.processEndedFrame],
    ["observedFrame", observation.observedFrame],
    ["pendingCount", observation.pendingCount],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${field} must be a nonnegative integer`);
    }
  }
  for (const [field, value] of [
    ["processEndedAtMs", observation.processEndedAtMs],
    ["observedAtMs", observation.observedAtMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a nonnegative finite number`);
    }
  }
  if (
    observation.observedFrame < observation.processEndedFrame ||
    observation.observedAtMs < observation.processEndedAtMs
  ) {
    throw new Error(
      "post-process catch observation cannot precede process completion",
    );
  }
}

export function snapshotContainsSpeciesDelta(
  initial: CatchStateEvidence,
  candidate: CatchStateEvidence,
  species: number,
  nationalDexNumberValue: number,
): boolean {
  return (
    hasNewPartyIdentity(initial.party, candidate.party, species) ||
    (!dexOwned(initial, nationalDexNumberValue) &&
      dexOwned(candidate, nationalDexNumberValue))
  );
}

export function hasNewPartyIdentity(
  initial: readonly PartyIdentityEvidence[],
  candidate: readonly PartyIdentityEvidence[],
  species: number,
): boolean {
  const initialIdentities = new Set(
    initial.map((mon) => `${String(mon.personality)}:${String(mon.otId)}`),
  );
  return candidate.some(
    (mon) =>
      mon.species === species &&
      !initialIdentities.has(`${String(mon.personality)}:${String(mon.otId)}`),
  );
}

export function nationalDexNumber(species: number): number {
  const value = SPECIES_TO_NATIONAL[species];
  if (value === undefined || value <= 0) {
    throw new Error(`species ${String(species)} has no National Dex mapping`);
  }
  return value;
}

export function dexOwned(
  snapshot: CatchStateEvidence,
  nationalDexNumberValue: number,
): boolean {
  const bitIndex = nationalDexNumberValue - 1;
  const byte = snapshot.dexOwned[Math.floor(bitIndex / 8)];
  if (byte === undefined) {
    throw new Error(
      `National Dex ${String(nationalDexNumberValue)} is outside owned bitfield`,
    );
  }
  return (byte & (1 << (bitIndex % 8))) !== 0;
}
