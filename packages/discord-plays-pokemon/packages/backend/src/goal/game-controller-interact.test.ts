import { describe, expect, test } from "bun:test";
import type {
  CardinalDirection,
  EngineMapTile,
} from "#src/emulator/engine-observation.ts";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { GameController, type GameControlPort } from "./game-controller.ts";
import type { GameObservationV2 } from "./game-observation.ts";

type ObservationInput = Readonly<{
  frame?: number;
  phase?: GameObservationV2["phase"];
  facing?: CardinalDirection;
  x?: number;
  y?: number;
  inputReady?: boolean;
  playerStable?: boolean;
  worldAvailable?: boolean;
}>;

function contextForPhase(
  phase: GameObservationV2["phase"],
): GameObservationV2["context"] {
  return {
    kind:
      phase === "unavailable"
        ? "unavailable"
        : phase === "overworld"
          ? "field"
          : phase === "scripted"
            ? "script-or-dialog"
            : phase === "battle"
              ? "battle"
              : "menu-or-transition",
    battleActive: phase === "battle",
    scriptOrDialogActive: phase === "scripted",
    dialogVisible: phase === "scripted",
    dialogInputReady: phase === "scripted",
    menuOrTransitionActive: phase === "other",
  };
}

function observation(input: ObservationInput = {}): GameObservationV2 {
  const phase = input.phase ?? "overworld";
  const frame = input.frame ?? 10;
  const world =
    input.worldAvailable === false
      ? null
      : {
          map: "Littleroot Town",
          mapGroup: 0,
          mapNum: 0,
          x: input.x ?? 10,
          y: input.y ?? 10,
          facing: input.facing ?? "north",
          movementMode: "on foot",
          runningState: 0,
          tileTransitionState: 0,
          onTileBehavior: "normal floor",
          collision: {
            north: { code: 0, passable: true },
            south: { code: 0, passable: true },
            west: { code: 0, passable: true },
            east: { code: 0, passable: true },
          },
          nearby: [],
        };
  return {
    schemaVersion: 2,
    id: `observation-v2:${String(frame)}`,
    frame,
    phase,
    context: contextForPhase(phase),
    readiness: {
      observationValid: world !== null,
      inputReady: input.inputReady ?? true,
      playerStable: input.playerStable ?? true,
      controlsLocked: false,
      scriptActive: phase === "scripted",
      dialogVisible: phase === "scripted",
      dialogInputReady: phase === "scripted",
      paletteFading: false,
    },
    battle: null,
    world,
    game: null,
  };
}

class InteractionPort implements GameControlPort {
  readonly presses: CommandInput[] = [];
  private current: GameObservationV2;
  private readonly afterPress: GameObservationV2[];

  constructor(
    initial: GameObservationV2,
    afterPress: readonly GameObservationV2[] = [],
  ) {
    this.current = initial;
    this.afterPress = [...afterPress];
  }

  observe(): GameObservationV2 {
    return this.current;
  }

  renderFrame(): Uint8Array {
    return new Uint8Array(4);
  }

  async press(command: CommandInput): Promise<void> {
    this.presses.push(command);
    const next = this.afterPress.shift();
    if (next !== undefined) this.current = next;
  }

  async waitFrames(frames: number): Promise<void> {
    await Promise.resolve(frames);
  }

  readMapTile(x: number, y: number): EngineMapTile {
    return {
      x,
      y,
      behavior: 0,
      collision: 0,
      elevation: 0,
      passable: true,
    };
  }
}

const INVALID_INITIAL_STATES: readonly Readonly<{
  direction?: CardinalDirection;
  name: string;
  observation: ObservationInput;
}>[] = [
  { name: "battle", observation: { phase: "battle" } },
  { direction: "north", name: "menu", observation: { phase: "other" } },
  { name: "scripted dialog", observation: { phase: "scripted" } },
  {
    direction: "north",
    name: "input-not-ready field",
    observation: { inputReady: false },
  },
  {
    direction: "east",
    name: "unstable field",
    observation: { playerStable: false },
  },
  {
    name: "field without world evidence",
    observation: { worldAvailable: false },
  },
];

describe("GameController interact", () => {
  test.each(INVALID_INITIAL_STATES)(
    "rejects $name without pressing a control",
    async ({ direction, observation: input }) => {
      const port = new InteractionPort(observation(input));
      const outcome = await new GameController(port).interact(direction);

      expect(port.presses).toEqual([]);
      expect(outcome.status).toBe("unavailable");
      expect(outcome.stopReason).toBe("field-input-not-ready");
      expect(outcome.inputApplied).toBe(false);
    },
  );

  test("does not press A when the field becomes not ready after turning", async () => {
    const port = new InteractionPort(observation({ facing: "north" }), [
      observation({ frame: 12, facing: "east", inputReady: false }),
    ]);

    const outcome = await new GameController(port).interact("east");

    expect(port.presses).toEqual([{ command: "right", quantity: 1 }]);
    expect(outcome.inputApplied).toBe(true);
    expect(outcome.after.readiness.inputReady).toBe(false);
  });

  test("does not press A when the direction press moves the player", async () => {
    const port = new InteractionPort(observation({ facing: "north" }), [
      observation({ frame: 12, facing: "east", x: 11 }),
    ]);

    const outcome = await new GameController(port).interact("east");

    expect(port.presses).toEqual([{ command: "right", quantity: 1 }]);
    expect(outcome.inputApplied).toBe(true);
    expect(outcome.tilesMoved).toBe(1);
    expect(outcome.after.world?.x).toBe(11);
  });

  test("presses A for ahead, current-facing, and turn-then-interact field actions", async () => {
    const ahead = new InteractionPort(observation());
    const currentFacing = new InteractionPort(observation({ facing: "north" }));
    const turn = new InteractionPort(observation({ facing: "north" }), [
      observation({ frame: 12, facing: "east" }),
      observation({ frame: 20, facing: "east" }),
    ]);

    await new GameController(ahead).interact();
    await new GameController(currentFacing).interact("north");
    await new GameController(turn).interact("east");

    expect(ahead.presses).toEqual([{ command: "a", quantity: 1 }]);
    expect(currentFacing.presses).toEqual([{ command: "a", quantity: 1 }]);
    expect(turn.presses).toEqual([
      { command: "right", quantity: 1 },
      { command: "a", quantity: 1 },
    ]);
  });
});
