import {
  decodeReplayObservations as decode,
  createReplayObservationActorSampler as createSampler,
  createReplayObservationKdaTimeline as createKdaTimeline,
} from "./observations/decode.mjs";

export type ReplayDecompressor = (
  stored: Uint8Array,
  target: Uint8Array,
) => Uint8Array;
export type ReplayObservedCombatEvent = {
  kind: "champion-kill" | "champion-death";
  context: number;
  partition: 0 | 1;
  timeSeconds: number;
  secondTimeBits: number;
};
export type ReplayObservedAssist = Omit<ReplayObservedCombatEvent, "kind"> & {
  kind: "champion-assist";
};
export type ReplayObservedLevel = {
  kind: "actor-level";
  context: number;
  footerRow: number | null;
  level: number;
  timeSeconds: number;
  secondTimeBits: number;
};
export type ReplayObservedReturn = Omit<ReplayObservedCombatEvent, "kind"> & {
  kind: "champion-return";
};
export type ReplayObservedStructure = {
  kind:
    | "turret-destruction"
    | "inhibitor-destruction"
    | "match-ending-structure-loss";
  context: number;
  timeSeconds: number;
  secondTimeBits: number;
};
export type ReplayObservations = {
  build: string;
  protocol: string;
  duration: number;
  roster: { champion: string; team: number }[];
  binding: {
    verified: { context: number; footerRow: number }[];
    unresolved: number[];
    assistEvents: number;
    events: ReplayObservedCombatEvent[];
    assists: ReplayObservedAssist[];
  };
  levels: {
    initialLevel: 1;
    events: ReplayObservedLevel[];
    finalLevels: { context: number; footerRow: number | null; level: number }[];
  } | null;
  returns: ReplayObservedReturn[] | null;
  turrets:
    (ReplayObservedStructure & { defendingPartition: 0 | 1 | null })[] | null;
  structures: ReplayObservedStructure[] | null;
  aliveCounts: { timestampMs: number; teamA: number; teamB: number }[] | null;
};
export type ReplayObservedActorState = {
  context: number;
  partition: 0 | 1;
  footerRow: number | null;
  champion: string | null;
  level: number;
  dead: boolean;
  kda: { kills: number; deaths: number; assists: number } | null;
};
export type ReplayObservationKdaTimeline = {
  actors: { partition: 0 | 1; champion: string | null }[];
  checkpoints: {
    timestampMs: number;
    kda: ({ kills: number; deaths: number; assists: number } | null)[];
  }[];
};

export type ReplayObservedElimination = Readonly<{
  timeSeconds: number;
  killerId: number;
  victimId: number;
}>;

export function createReplayObservationEliminations(
  binding: ReplayObservations["binding"],
): ReplayObservedElimination[] {
  const participants = new Set(binding.verified.map(({ context }) => context));
  const cohorts = new Map<number, ReplayObservedCombatEvent[]>();
  for (const event of binding.events) {
    const cohort = cohorts.get(event.secondTimeBits);
    if (cohort === undefined) cohorts.set(event.secondTimeBits, [event]);
    else cohort.push(event);
  }
  const result: ReplayObservedElimination[] = [];
  for (const events of cohorts.values()) {
    for (const side of [0, 1]) {
      const killers = events.filter(
        (event) => event.kind === "champion-kill" && event.partition === side,
      );
      const victims = events.filter(
        (event) => event.kind === "champion-death" && event.partition !== side,
      );
      const [killer] = killers;
      const [victim] = victims;
      if (
        killer === undefined ||
        victim === undefined ||
        killers.length !== 1 ||
        victims.length !== 1
      )
        continue;
      if (
        !participants.has(killer.context) ||
        !participants.has(victim.context)
      )
        continue;
      result.push({
        timeSeconds: Math.max(killer.timeSeconds, victim.timeSeconds),
        killerId: killer.context,
        victimId: victim.context,
      });
    }
  }
  return result.sort((a, b) => a.timeSeconds - b.timeSeconds);
}

export function decodeReplayObservations(
  buffer: ArrayBuffer,
  decompress: ReplayDecompressor,
  options?: { lifecycle?: boolean },
): ReplayObservations {
  return decode(buffer, decompress, options);
}

export function createReplayObservationActorSampler(
  observations: ReplayObservations,
): (timeSeconds: number) => ReplayObservedActorState[] {
  return createSampler(observations);
}

export function createReplayObservationKdaTimeline(
  observations: ReplayObservations,
): ReplayObservationKdaTimeline {
  return createKdaTimeline(observations);
}
