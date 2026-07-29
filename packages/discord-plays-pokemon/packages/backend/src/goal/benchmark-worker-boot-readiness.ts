import { BUTTON } from "#src/emulator/constants.ts";
import type { Emulator } from "#src/emulator/emulator.ts";
import type { EnginePhase } from "#src/emulator/engine-observation.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import type { GameSnapshot } from "#src/game/events/types.ts";
import { readSpatialSnapshot } from "#src/game/spatial/spatial-snapshot.ts";
import { readGameObservation } from "./game-observation.ts";

export type BenchmarkBootPosition = Readonly<{
  frame: number;
  mapGroup: number;
  mapNum: number;
  x: number;
  y: number;
}>;

export type BenchmarkBootSample = Readonly<{
  frame: number;
  phase: EnginePhase;
  contextKind:
    | "unavailable"
    | "field"
    | "script-or-dialog"
    | "battle"
    | "menu-or-transition";
  observationValid: boolean;
  inputReady: boolean;
  playerStable: boolean;
  gameAvailable: boolean;
  snapshotAvailable: boolean;
  spatialAvailable: boolean;
  world: Readonly<{
    mapGroup: number;
    mapNum: number;
    x: number;
    y: number;
  }> | null;
}>;

export type BenchmarkBootAssessment = Readonly<{
  ready: boolean;
  candidate: BenchmarkBootPosition | null;
}>;

export function assessBenchmarkBootReadiness(
  previous: BenchmarkBootPosition | null,
  sample: BenchmarkBootSample,
): BenchmarkBootAssessment {
  if (
    sample.phase !== "overworld" ||
    sample.contextKind !== "field" ||
    !sample.observationValid ||
    !sample.inputReady ||
    !sample.playerStable ||
    !sample.gameAvailable ||
    !sample.snapshotAvailable ||
    !sample.spatialAvailable ||
    sample.world === null
  ) {
    return { ready: false, candidate: null };
  }

  const candidate: BenchmarkBootPosition = {
    frame: sample.frame,
    mapGroup: sample.world.mapGroup,
    mapNum: sample.world.mapNum,
    x: sample.world.x,
    y: sample.world.y,
  };
  return {
    ready:
      previous !== null &&
      candidate.frame > previous.frame &&
      samePosition(previous, candidate),
    candidate,
  };
}

function samePosition(
  left: BenchmarkBootPosition,
  right: BenchmarkBootPosition,
): boolean {
  return (
    left.mapGroup === right.mapGroup &&
    left.mapNum === right.mapNum &&
    left.x === right.x &&
    left.y === right.y
  );
}

export function liveBenchmarkSnapshot(emulator: Emulator): GameSnapshot | null {
  return readGameSnapshot(emulator.memoryReader(), emulator.gameSymbols());
}

export function liveBenchmarkSpatial(
  emulator: Emulator,
): ReturnType<typeof readSpatialSnapshot> {
  return readSpatialSnapshot(emulator.memoryReader(), emulator.gameSymbols());
}

export async function bootBenchmarkSave(
  emulator: Emulator,
  timeoutSeconds: number,
): Promise<GameSnapshot> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let nextContinuePress = Date.now() + 500;
  let bootCandidate: BenchmarkBootPosition | null = null;
  for (;;) {
    const snapshot = liveBenchmarkSnapshot(emulator);
    const spatial = liveBenchmarkSpatial(emulator);
    const observation = readGameObservation(emulator);
    const assessment = assessBenchmarkBootReadiness(bootCandidate, {
      frame: observation.frame,
      phase: observation.phase,
      contextKind: observation.context.kind,
      observationValid: observation.readiness.observationValid,
      inputReady: observation.readiness.inputReady,
      playerStable: observation.readiness.playerStable,
      gameAvailable: observation.game !== null,
      snapshotAvailable: snapshot !== null,
      spatialAvailable: spatial !== null,
      world:
        observation.world === null
          ? null
          : {
              mapGroup: observation.world.mapGroup,
              mapNum: observation.world.mapNum,
              x: observation.world.x,
              y: observation.world.y,
            },
    });
    bootCandidate = assessment.candidate;
    if (assessment.ready && snapshot !== null) return snapshot;
    if (Date.now() >= deadline) {
      throw new Error(
        `emulator did not boot and continue within ${String(timeoutSeconds)} seconds`,
      );
    }
    if (bootCandidate === null && Date.now() >= nextContinuePress) {
      await emulator.queuePress(BUTTON.a, 3, 3);
      nextContinuePress = Date.now() + 750;
    }
    await Bun.sleep(100);
  }
}
