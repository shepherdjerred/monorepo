import { describe, expect, test } from "bun:test";
import { summarizeCodexJsonl } from "./benchmark-codex-telemetry.ts";
import {
  assessBenchmarkBootReadiness,
  type BenchmarkBootSample,
} from "./benchmark-worker-boot-readiness.ts";

function bootSample(
  overrides: Partial<BenchmarkBootSample> = {},
): BenchmarkBootSample {
  return {
    frame: 100,
    phase: "overworld",
    contextKind: "field",
    observationValid: true,
    inputReady: true,
    playerStable: true,
    gameAvailable: true,
    snapshotAvailable: true,
    spatialAvailable: true,
    world: { mapGroup: 0, mapNum: 9, x: 5, y: 6 },
    ...overrides,
  };
}

function battleObservation(x: number) {
  return {
    schemaVersion: 2,
    phase: "battle",
    context: { kind: "battle" },
    world: {
      map: "Route 101",
      mapGroup: 0,
      mapNum: 16,
      x,
      y: 8,
    },
  };
}

describe("assessBenchmarkBootReadiness", () => {
  test("requires continued save data and authoritative playable readiness", () => {
    const titleScreen = assessBenchmarkBootReadiness(
      null,
      bootSample({ gameAvailable: false }),
    );
    const scripted = assessBenchmarkBootReadiness(
      null,
      bootSample({
        phase: "scripted",
        contextKind: "script-or-dialog",
      }),
    );
    const unstable = assessBenchmarkBootReadiness(
      null,
      bootSample({ playerStable: false }),
    );

    expect(titleScreen).toEqual({ ready: false, candidate: null });
    expect(scripted).toEqual({ ready: false, candidate: null });
    expect(unstable).toEqual({ ready: false, candidate: null });
  });

  test("requires the same playable position on two distinct frames", () => {
    const first = assessBenchmarkBootReadiness(null, bootSample());
    const sameFrame = assessBenchmarkBootReadiness(
      first.candidate,
      bootSample(),
    );
    const moved = assessBenchmarkBootReadiness(
      first.candidate,
      bootSample({
        frame: 101,
        world: { mapGroup: 0, mapNum: 9, x: 6, y: 6 },
      }),
    );
    const stable = assessBenchmarkBootReadiness(
      moved.candidate,
      bootSample({
        frame: 102,
        world: { mapGroup: 0, mapNum: 9, x: 6, y: 6 },
      }),
    );

    expect(first.ready).toBe(false);
    expect(sameFrame.ready).toBe(false);
    expect(moved.ready).toBe(false);
    expect(stable.ready).toBe(true);
    expect(stable.candidate).toEqual({
      frame: 102,
      mapGroup: 0,
      mapNum: 9,
      x: 6,
      y: 6,
    });
  });
});

describe("summarizeCodexJsonl chained command output", () => {
  test("counts every JSON-lines action, observation invocation, output character, and explicit ignored input", () => {
    const output = [
      JSON.stringify({
        action: "move:east",
        status: "completed",
        before: { map: "Route 101", x: 10, y: 8 },
        after: { map: "Route 101", x: 11, y: 8 },
      }),
      "ignored input while waiting for the next frame",
      JSON.stringify({
        action: "move:west",
        status: "completed",
        before: { map: "Route 101", x: 11, y: 8 },
        after: { map: "Route 101", x: 10, y: 8 },
      }),
      "IGNORED INPUT while the menu was closed",
      JSON.stringify({
        action: "move:south",
        status: "stopped",
        stopReason: "collision",
        before: { map: "Route 101", x: 10, y: 8 },
        after: { map: "Route 101", x: 10, y: 8 },
      }),
    ].join("\n");
    const line = {
      type: "item.completed",
      item: {
        id: "chained-actions",
        type: "command_execution",
        command:
          "pokemonctl observe --full; pokemonctl observe; pokemonctl move east --tiles 1",
        aggregated_output: output,
        stdout: "must not be double-counted",
        exit_code: 0,
      },
    };

    const telemetry = summarizeCodexJsonl(JSON.stringify(line));

    expect(telemetry.toolCalls).toBe(1);
    expect(telemetry.fullObservations).toBe(1);
    expect(telemetry.compactObservations).toBe(1);
    expect(telemetry.toolOutputCharacters).toBe(output.length);
    expect(telemetry.movementActions).toBe(3);
    expect(telemetry.movementStops).toBe(1);
    expect(telemetry.repeatedPositionLoops).toBe(2);
    expect(telemetry.ignoredInputs).toBe(2);
  });

  test("does not use legacy locations after a structured non-movement outcome", () => {
    const line = {
      type: "item.completed",
      item: {
        id: "structured-non-movement",
        type: "command_execution",
        command: "pokemonctl press up",
        aggregated_output: [
          JSON.stringify({
            action: "tap:a",
            status: "applied",
            before: battleObservation(10),
            after: battleObservation(10),
          }),
          "Location: Route 101 @ (10, 8) facing north, on foot",
        ].join("\n"),
        exit_code: 0,
      },
    };

    expect(summarizeCodexJsonl(JSON.stringify(line)).movementActions).toBe(0);
  });
});
