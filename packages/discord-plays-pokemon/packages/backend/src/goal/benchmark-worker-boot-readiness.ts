import type { EnginePhase } from "#src/emulator/engine-observation.ts";

// Pure, unit-tested boot-readiness assessment for the goal benchmark. The
// streamed benchmark worker (scripts/goal-benchmark-worker.ts) inlines an
// identical copy of assessBenchmarkBootReadiness because it runs against
// arbitrary target checkouts and cannot import this runner-owned harness helper;
// keep the two in sync. This module holds the version covered by
// benchmark-telemetry.test.ts.

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
