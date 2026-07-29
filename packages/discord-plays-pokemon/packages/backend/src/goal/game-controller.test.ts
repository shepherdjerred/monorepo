import { describe, expect, test } from "bun:test";
import type {
  CardinalDirection,
  EngineMapTile,
} from "#src/emulator/engine-observation.ts";
import type { EngineMapTopologyV1 } from "#src/emulator/engine-map-topology.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { GameController, type GameControlPort } from "./game-controller.ts";
import { actionOutcome } from "./game-action-outcome.ts";
import type { GameObservationV2 } from "./game-observation.ts";

type ObservationInput = Readonly<{
  frame?: number;
  phase?: GameObservationV2["phase"];
  x?: number;
  y?: number;
  facing?: CardinalDirection;
  mapNum?: number;
  inputReady?: boolean;
  collisionNorth?: number;
  scriptOrDialogActive?: boolean;
  dialogVisible?: boolean;
  dialogInputReady?: boolean;
  battleActionCursor?: number;
  battleControllerExecFlags?: number;
  nearby?: NonNullable<GameObservationV2["world"]>["nearby"];
}>;

function observation(input: ObservationInput = {}): GameObservationV2 {
  const frame = input.frame ?? 10;
  const dialogVisible = input.dialogVisible === true;
  const dialogInputReady = input.dialogInputReady === true;
  return {
    schemaVersion: 2,
    id: `observation-v2:${String(frame)}`,
    frame,
    phase: input.phase ?? "overworld",
    context: {
      kind:
        input.phase === "battle"
          ? "battle"
          : input.scriptOrDialogActive === true
            ? "script-or-dialog"
            : "field",
      battleActive: input.phase === "battle",
      scriptOrDialogActive: input.scriptOrDialogActive ?? false,
      dialogVisible,
      dialogInputReady,
      menuOrTransitionActive: false,
    },
    readiness: {
      observationValid: true,
      inputReady: input.inputReady ?? true,
      playerStable: true,
      controlsLocked: false,
      scriptActive: false,
      dialogVisible,
      dialogInputReady,
      paletteFading: false,
    },
    battle:
      input.phase === "battle"
        ? {
            typeFlags: 0,
            controllerExecFlags: input.battleControllerExecFlags ?? 0,
            battlersCount: 2,
            inputBattler: 0,
            activeBattler: 0,
            menu: "action",
            actionCursor: input.battleActionCursor ?? 0,
            moveCursor: 0,
            currentMove: 0,
            chosenMove: 0,
            battlers: [],
          }
        : null,
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
      nearby: input.nearby ?? [],
    },
    game: null,
  };
}

function mapTopology(
  input: Readonly<{
    connections?: EngineMapTopologyV1["connections"];
    warps?: EngineMapTopologyV1["warps"];
  }> = {},
): EngineMapTopologyV1 {
  return {
    version: 1,
    size: 28,
    frame: 10,
    mapGroup: 0,
    mapNum: 0,
    width: 6,
    height: 6,
    bounds: { minX: 7, maxX: 12, minY: 7, maxY: 12 },
    connections: input.connections ?? [],
    warps: input.warps ?? [],
  };
}

class FakeControlPort implements GameControlPort {
  readonly presses: CommandInput[] = [];
  private current: GameObservationV2;
  private readonly afterPress: GameObservationV2[];
  private currentFrame: Uint8Array;
  private readonly afterPressFrames: Uint8Array[];
  private readonly blocked: ReadonlySet<string>;
  private readonly topology: EngineMapTopologyV1 | null;

  constructor(
    initial: GameObservationV2,
    afterPress: readonly GameObservationV2[],
    options: Readonly<{
      blocked?: ReadonlySet<string>;
      initialFrame?: Uint8Array;
      afterPressFrames?: readonly Uint8Array[];
      topology?: EngineMapTopologyV1;
    }> = {},
  ) {
    this.current = initial;
    this.afterPress = [...afterPress];
    this.blocked = options.blocked ?? new Set<string>();
    this.currentFrame = options.initialFrame ?? renderedFrame();
    this.afterPressFrames = [...(options.afterPressFrames ?? [])];
    this.topology = options.topology ?? null;
  }

  observe(): GameObservationV2 {
    return this.current;
  }

  setObservation(currentObservation: GameObservationV2): void {
    this.current = currentObservation;
  }

  renderFrame(): Uint8Array {
    return this.currentFrame;
  }

  async press(command: CommandInput): Promise<void> {
    this.presses.push(command);
    const next = this.afterPress.shift();
    if (next !== undefined) this.current = next;
    const nextFrame = this.afterPressFrames.shift();
    if (nextFrame !== undefined) this.currentFrame = nextFrame;
  }

  async waitFrames(frames: number): Promise<void> {
    await Promise.resolve(frames);
  }

  readMapTile(x: number, y: number): EngineMapTile {
    const passable = !this.blocked.has(`${String(x)},${String(y)}`);
    return {
      x,
      y,
      behavior: 0,
      collision: passable ? 0 : 1,
      elevation: 0,
      passable,
    };
  }

  readMapTopology(): EngineMapTopologyV1 | null {
    return this.topology;
  }
}

function renderedFrame(changedPixels = 0): Uint8Array {
  const frame = new Uint8Array(240 * 160 * 4);
  for (let pixel = 0; pixel < changedPixels; pixel += 1) {
    frame[pixel * 4] = 255;
  }
  return frame;
}

function nearbyNpc(
  dx: number,
  dy: number,
): NonNullable<GameObservationV2["world"]>["nearby"][number] {
  return {
    localId: 1,
    graphicsId: 2,
    kind: "npc",
    movementType: 0,
    dx,
    dy,
    facing: "south",
    active: true,
  };
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

  test("reports battle cursor and controller changes as applied state", () => {
    const before = observation({
      phase: "battle",
      battleActionCursor: 0,
      battleControllerExecFlags: 1,
    });
    const after = observation({
      frame: 12,
      phase: "battle",
      battleActionCursor: 1,
      battleControllerExecFlags: 2,
    });
    const outcome = actionOutcome("tap:down", before, after, {
      inputApplied: true,
    });
    expect(outcome.status).toBe("applied");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.battleChanged).toBe(true);
    expect(outcome.stateChanged).toBe(true);
  });

  test("does not promote a tiny visual fluctuation to applied", () => {
    const before = observation();
    const after = observation({ frame: 12 });
    const outcome = actionOutcome("tap:a", before, after, {
      inputApplied: true,
      visualChangeRatio: 0.0001,
    });
    expect(outcome.status).toBe("no-effect");
    expect(outcome.visualChanged).toBe(false);
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

  test("rejects movement during a scripted dialog despite input readiness", async () => {
    const scripted = observation({
      phase: "scripted",
      scriptOrDialogActive: true,
      dialogVisible: true,
      dialogInputReady: true,
      inputReady: true,
    });
    const port = new FakeControlPort(scripted, []);
    const controller = new GameController(port);

    const move = await controller.move("north", 1);
    const navigation = await controller.navigate({ x: 10, y: 9 }, 4, 4);

    expect(port.presses).toEqual([]);
    expect(move.status).toBe("unavailable");
    expect(move.stopReason).toBe("field-input-not-ready");
    expect(navigation.stopReason).toBe("field-input-not-ready");
    expect(navigation.attemptsMade).toBe(0);
  });

  test("stops repeated movement if the authoritative phase changes", async () => {
    const initial = observation({ x: 10, y: 10, facing: "north" });
    const moved = observation({ frame: 12, x: 10, y: 9, facing: "north" });
    const scripted = observation({
      frame: 20,
      phase: "scripted",
      x: 10,
      y: 9,
      inputReady: true,
      scriptOrDialogActive: true,
      dialogVisible: true,
      dialogInputReady: true,
    });
    const port = new FakeControlPort(initial, [moved]);
    const originalWaitFrames = port.waitFrames.bind(port);
    let waits = 0;
    port.waitFrames = async (frames: number): Promise<void> => {
      await originalWaitFrames(frames);
      waits += 1;
      if (waits === 2) {
        port.setObservation(scripted);
      }
    };
    const controller = new GameController(port);

    const outcome = await controller.move("north", 3);

    expect(port.presses).toEqual([{ command: "up", quantity: 1 }]);
    expect(outcome.stopReason).toBe("phase-changed");
    expect(outcome.after.phase).toBe("scripted");
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

  test("recognizes a settled battle cursor change as applied", async () => {
    const initial = observation({
      phase: "battle",
      battleActionCursor: 0,
      battleControllerExecFlags: 1,
    });
    const changed = observation({
      frame: 20,
      phase: "battle",
      battleActionCursor: 1,
      battleControllerExecFlags: 2,
    });
    const port = new FakeControlPort(initial, [changed]);
    const controller = new GameController(port);

    const outcome = await controller.tap("down");

    expect(outcome.status).toBe("applied");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.battleChanged).toBe(true);
    expect(outcome.stateChanged).toBe(true);
  });

  test("recognizes a dialog waiting for input as an applied advance", async () => {
    const scripted = observation({
      phase: "scripted",
      scriptOrDialogActive: true,
      dialogVisible: true,
      dialogInputReady: true,
    });
    const advanced = observation({
      frame: 20,
      phase: "scripted",
      scriptOrDialogActive: true,
      dialogVisible: true,
      dialogInputReady: true,
    });
    const port = new FakeControlPort(scripted, [advanced], {
      initialFrame: renderedFrame(),
      afterPressFrames: [renderedFrame(300)],
    });
    const controller = new GameController(port);

    const outcome = await controller.advance();

    expect(port.presses).toEqual([{ command: "a", quantity: 1 }]);
    expect(outcome.status).toBe("applied");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.stateChanged).toBe(false);
    expect(outcome.visualChanged).toBe(true);
    expect(outcome.visualChangeRatio).toBeGreaterThan(0.0025);
  });

  test("does not advance during a broad scripted phase without dialog evidence", async () => {
    const scripted = observation({
      phase: "scripted",
      scriptOrDialogActive: true,
      dialogVisible: false,
      dialogInputReady: false,
    });
    const port = new FakeControlPort(scripted, []);
    const controller = new GameController(port);

    const outcome = await controller.advance();

    expect(port.presses).toEqual([]);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.stopReason).toBe("dialog-not-ready");
  });

  test("does not advance while a visible dialog is still printing", async () => {
    const printing = observation({
      phase: "scripted",
      scriptOrDialogActive: true,
      dialogVisible: true,
      dialogInputReady: false,
    });
    const port = new FakeControlPort(printing, []);
    const controller = new GameController(port);

    const outcome = await controller.advance();

    expect(port.presses).toEqual([]);
    expect(outcome.status).toBe("unavailable");
    expect(outcome.stopReason).toBe("dialog-not-ready");
  });

  test("reports an already-satisfied wait condition as completed", async () => {
    const ready = observation();
    const port = new FakeControlPort(ready, []);
    const controller = new GameController(port);

    const outcome = await controller.waitFor("ready", 60);

    expect(outcome.status).toBe("applied");
    expect(outcome.stopReason).toBe("completed");
    expect(outcome.framesElapsed).toBe(0);
    expect(port.presses).toHaveLength(0);
  });
});

describe("GameController navigation", () => {
  test("navigates a bounded current-map path to exact coordinates", async () => {
    const start = observation({ x: 5, y: 5, facing: "east" });
    const port = new FakeControlPort(start, [
      observation({ frame: 12, x: 6, y: 5, facing: "east" }),
      observation({ frame: 24, x: 7, y: 5, facing: "east" }),
    ]);
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 7, y: 5 }, 10, 4);

    expect(result.status).toBe("arrived");
    expect(result.stopReason).toBe("target-reached");
    expect(result.attemptsMade).toBe(2);
    expect(result.stepsTaken).toBe(2);
    expect(port.presses.map((press) => press.command)).toEqual([
      "right",
      "right",
    ]);
  });

  test("reaches the target on the final allowed navigation attempt", async () => {
    const start = observation({ x: 5, y: 5, facing: "east" });
    const port = new FakeControlPort(start, [
      observation({ frame: 12, x: 6, y: 5, facing: "east" }),
    ]);
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 6, y: 5 }, 1, 4);

    expect(result.status).toBe("arrived");
    expect(result.stopReason).toBe("target-reached");
    expect(result.attemptsMade).toBe(1);
    expect(result.stepsTaken).toBe(1);
    expect(port.presses).toHaveLength(1);
  });

  test("consumes the navigation budget for failed movement attempts", async () => {
    const start = observation({ x: 5, y: 5, facing: "east" });
    const port = new FakeControlPort(start, []);
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 7, y: 5 }, 2, 4);

    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("max-steps");
    expect(result.attemptsMade).toBe(2);
    expect(result.stepsTaken).toBe(0);
    expect(port.presses).toHaveLength(3);
  });

  test("recomputes moving-object blocks after every navigation step", async () => {
    const allowed = new Set(["5,5", "5,4", "6,4", "7,4", "6,5", "7,5"]);
    const blocked = new Set<string>();
    for (let x = 1; x <= 9; x += 1) {
      for (let y = 1; y <= 9; y += 1) {
        const key = `${String(x)},${String(y)}`;
        if (!allowed.has(key)) blocked.add(key);
      }
    }
    const start = observation({
      x: 5,
      y: 5,
      nearby: [nearbyNpc(1, 0)],
    });
    const port = new FakeControlPort(
      start,
      [
        observation({
          frame: 12,
          x: 5,
          y: 4,
          nearby: [nearbyNpc(2, 0)],
        }),
        observation({
          frame: 24,
          x: 5,
          y: 5,
          nearby: [nearbyNpc(2, -1)],
        }),
        observation({
          frame: 36,
          x: 6,
          y: 5,
          nearby: [nearbyNpc(1, -1)],
        }),
        observation({ frame: 48, x: 7, y: 5 }),
      ],
      { blocked },
    );
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 7, y: 5 }, 10, 4);

    expect(result.status).toBe("arrived");
    expect(result.attemptsMade).toBe(4);
    expect(result.stepsTaken).toBe(4);
    expect(port.presses.map((press) => press.command)).toEqual([
      "up",
      "down",
      "right",
      "right",
    ]);
  });

  test("revalidates a failed corridor tile after a transient blocker moves", async () => {
    const allowed = new Set(["5,5", "6,5", "7,5"]);
    const blocked = new Set<string>();
    for (let x = 1; x <= 9; x += 1) {
      for (let y = 1; y <= 9; y += 1) {
        const key = `${String(x)},${String(y)}`;
        if (!allowed.has(key)) blocked.add(key);
      }
    }
    const start = observation({ x: 5, y: 5, facing: "east" });
    const port = new FakeControlPort(
      start,
      [
        // A transient blocker arrives after planning, so the first semantic
        // move exhausts its turn/move presses without changing coordinates.
        observation({ frame: 12, x: 5, y: 5, facing: "east" }),
        observation({ frame: 24, x: 5, y: 5, facing: "east" }),
        // The next observation no longer reports a blocker in the corridor.
        observation({ frame: 36, x: 6, y: 5, facing: "east" }),
        observation({ frame: 48, x: 7, y: 5, facing: "east" }),
      ],
      { blocked },
    );
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 7, y: 5 }, 3, 4);

    expect(result.status).toBe("arrived");
    expect(result.stopReason).toBe("target-reached");
    expect(result.attemptsMade).toBe(3);
    expect(result.stepsTaken).toBe(2);
    expect(port.presses.map((press) => press.command)).toEqual([
      "right",
      "right",
      "right",
      "right",
    ]);
  });

  test("bounds revalidation when an unobserved blocker never moves", async () => {
    const allowed = new Set(["5,5", "6,5"]);
    const blocked = new Set<string>();
    for (let x = 1; x <= 9; x += 1) {
      for (let y = 1; y <= 9; y += 1) {
        const key = `${String(x)},${String(y)}`;
        if (!allowed.has(key)) blocked.add(key);
      }
    }
    const start = observation({ x: 5, y: 5, facing: "east" });
    const port = new FakeControlPort(start, [], { blocked });
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 6, y: 5 }, 3, 4);

    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("max-steps");
    expect(result.attemptsMade).toBe(3);
    expect(result.stepsTaken).toBe(0);
    expect(port.presses.map((press) => press.command)).toEqual([
      "right",
      "right",
      "right",
      "right",
      "right",
      "right",
    ]);
  });

  test("stops navigation when movement crosses a map boundary", async () => {
    const start = observation({ x: 5, y: 5, facing: "east" });
    const port = new FakeControlPort(start, [
      observation({
        frame: 12,
        x: 6,
        y: 5,
        facing: "east",
        mapNum: 2,
      }),
    ]);
    const controller = new GameController(port);

    const result = await controller.navigate({ x: 7, y: 5 }, 10, 4);

    expect(result.status).toBe("stopped");
    expect(result.stopReason).toBe("map-changed");
    expect(port.presses).toHaveLength(1);
  });
});

describe("GameController exit navigation", () => {
  test("navigates a selected connection and stops at the first map change", async () => {
    const topology = mapTopology({
      connections: [
        {
          version: 1,
          size: 24,
          index: 0,
          direction: "east",
          destination: { mapGroup: 0, mapNum: 1 },
          offset: 0,
          span: {
            start: { x: 12, y: 9 },
            end: { x: 12, y: 10 },
          },
        },
      ],
    });
    const port = new FakeControlPort(
      observation({ x: 10, y: 9, facing: "east" }),
      [
        observation({ frame: 12, x: 11, y: 9, facing: "east" }),
        observation({ frame: 24, x: 12, y: 9, facing: "east" }),
        observation({
          frame: 36,
          x: 7,
          y: 9,
          facing: "east",
          mapNum: 1,
        }),
      ],
      { topology },
    );

    const result = await new GameController(port).navigateExit(
      "connection:0",
      3,
    );

    expect(result.status).toBe("traversed");
    expect(result.stopReason).toBe("exit-traversed");
    expect(result.attemptsMade).toBe(3);
    expect(result.stepsTaken).toBe(2);
    expect(port.presses.map((press) => press.command)).toEqual([
      "right",
      "right",
      "right",
    ]);
  });

  test("activates only the selected warp and stops without choosing a next route", async () => {
    const topology = mapTopology({
      warps: [
        {
          version: 1,
          size: 24,
          index: 3,
          trigger: { x: 10, y: 9, elevation: 0, behavior: 0 },
          activation: "step",
          destination: {
            mapGroup: 1,
            mapNum: 2,
            warpId: 0,
            dynamic: false,
            landing: { x: 7, y: 7 },
          },
        },
      ],
    });
    const port = new FakeControlPort(
      observation({ x: 10, y: 10, facing: "north" }),
      [observation({ frame: 12, x: 10, y: 9, facing: "north" })],
      { topology },
    );

    const result = await new GameController(port).navigateExit("warp:3", 1);

    expect(result.status).toBe("triggered");
    expect(result.stopReason).toBe("exit-triggered");
    expect(result.attemptsMade).toBe(1);
    expect(result.stepsTaken).toBe(1);
    expect(port.presses.map((press) => press.command)).toEqual(["up"]);
  });

  test("rejects unavailable and non-navigable exit ids without input", async () => {
    const topology = mapTopology({
      warps: [
        {
          version: 1,
          size: 24,
          index: 0,
          trigger: { x: 10, y: 9, elevation: 0, behavior: 0 },
          activation: "unsupported",
          destination: {
            mapGroup: 0,
            mapNum: 0,
            warpId: 127,
            dynamic: true,
            landing: null,
          },
        },
      ],
    });
    const port = new FakeControlPort(observation(), [], { topology });
    const controller = new GameController(port);

    const missing = await controller.navigateExit("connection:9", 5);
    const unsupported = await controller.navigateExit("warp:0", 5);

    expect(missing.stopReason).toBe("exit-not-found");
    expect(unsupported.stopReason).toBe("exit-not-navigable");
    expect(port.presses).toEqual([]);
  });
});
