import { describe, expect, test } from "bun:test";
import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import {
  actionOutcome,
  GameController,
  type GameControlPort,
} from "./game-controller.ts";
import type { GameObservationV1 } from "./game-observation.ts";

type ObservationInput = Readonly<{
  frame?: number;
  phase?: GameObservationV1["phase"];
  x?: number;
  y?: number;
  facing?: CardinalDirection;
  mapNum?: number;
  inputReady?: boolean;
  collisionNorth?: number;
}>;

function observation(input: ObservationInput = {}): GameObservationV1 {
  const frame = input.frame ?? 10;
  return {
    schemaVersion: 1,
    id: `observation-v1:${String(frame)}`,
    frame,
    phase: input.phase ?? "overworld",
    readiness: {
      observationValid: true,
      inputReady: input.inputReady ?? true,
      playerStable: true,
      controlsLocked: false,
      scriptActive: false,
      paletteFading: false,
    },
    world: {
      map: input.mapNum === 1 ? "Route 101" : "Littleroot Town",
      mapGroup: 0,
      mapNum: input.mapNum ?? 0,
      x: input.x ?? 10,
      y: input.y ?? 10,
      facing: input.facing ?? "north",
      movementMode: "on foot",
      runningState: 0,
      tileTransitionState: 0,
      onTileBehavior: "normal floor",
      collision: {
        north: {
          code: input.collisionNorth ?? 0,
          passable: (input.collisionNorth ?? 0) === 0,
        },
        south: { code: 0, passable: true },
        west: { code: 0, passable: true },
        east: { code: 0, passable: true },
      },
      nearby: [],
    },
    game: null,
  };
}

class FakeControlPort implements GameControlPort {
  readonly presses: CommandInput[] = [];
  private current: GameObservationV1;
  private readonly afterPress: GameObservationV1[];

  constructor(
    initial: GameObservationV1,
    afterPress: readonly GameObservationV1[],
  ) {
    this.current = initial;
    this.afterPress = [...afterPress];
  }

  observe(): GameObservationV1 {
    return this.current;
  }

  async press(command: CommandInput): Promise<void> {
    this.presses.push(command);
    const next = this.afterPress.shift();
    if (next !== undefined) this.current = next;
  }

  async waitFrames(frames: number): Promise<void> {
    await Promise.resolve(frames);
  }
}

describe("actionOutcome", () => {
  test("does not call a turn-in-place blocked", () => {
    const before = observation({ facing: "west" });
    const after = observation({ frame: 12, facing: "north" });
    const outcome = actionOutcome("move:north", before, after, {
      inputApplied: true,
      direction: "north",
    });
    expect(outcome.status).toBe("applied");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.facingChanged).toBe(true);
    expect(outcome.tilesMoved).toBe(0);
  });

  test("requires collision evidence before reporting blocked", () => {
    const before = observation({ facing: "north", collisionNorth: 1 });
    const after = observation({
      frame: 12,
      facing: "north",
      collisionNorth: 1,
    });
    const outcome = actionOutcome("move:north", before, after, {
      inputApplied: true,
      direction: "north",
    });
    expect(outcome.status).toBe("blocked");
    expect(outcome.stopReason).toBe("collision");
  });

  test("reports a map transition as a context change", () => {
    const before = observation({ mapNum: 0 });
    const after = observation({ frame: 20, mapNum: 1 });
    const outcome = actionOutcome("move:north", before, after, {
      inputApplied: true,
      direction: "north",
    });
    expect(outcome.status).toBe("context-changed");
    expect(outcome.stopReason).toBe("map-changed");
    expect(outcome.mapChanged).toBe(true);
  });
});

describe("GameController", () => {
  test("turns, settles, then moves one requested tile", async () => {
    const initial = observation({ facing: "west", x: 10 });
    const turned = observation({ frame: 12, facing: "north", x: 10 });
    const moved = observation({ frame: 20, facing: "north", x: 10, y: 9 });
    const port = new FakeControlPort(initial, [turned, moved]);
    const controller = new GameController(port);

    const outcome = await controller.move("north", 1);

    expect(port.presses).toEqual([
      { command: "up", quantity: 1 },
      { command: "up", quantity: 1 },
    ]);
    expect(outcome.status).toBe("applied");
    expect(outcome.tilesMoved).toBe(1);
  });

  test("stops a repeated tap when the phase changes", async () => {
    const initial = observation({ phase: "overworld" });
    const battle = observation({
      frame: 20,
      phase: "battle",
      inputReady: false,
    });
    const port = new FakeControlPort(initial, [battle]);
    const controller = new GameController(port);

    const outcome = await controller.tap("a", 5);

    expect(port.presses).toHaveLength(1);
    expect(outcome.status).toBe("context-changed");
    expect(outcome.stopReason).toBe("phase-changed");
  });
});
