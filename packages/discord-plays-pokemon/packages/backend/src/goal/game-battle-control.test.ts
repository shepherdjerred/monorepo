import { describe, expect, test } from "bun:test";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { GameBattleControl } from "./game-battle-control.ts";
import type { GameObservationV2 } from "./game-observation.ts";
import { handlePokemonctlBattle } from "./pokemonctl-battle.ts";

type BattleInput = Readonly<{
  frame: number;
  menu?: NonNullable<GameObservationV2["battle"]>["menu"];
  actionCursor?: number;
  moveCursor?: number;
  bag?: NonNullable<GameObservationV2["battle"]>["bag"];
}>;

function observation(input: BattleInput): GameObservationV2 {
  return {
    schemaVersion: 2,
    id: `observation-v2:${String(input.frame)}`,
    frame: input.frame,
    phase: "battle",
    context: {
      kind: "battle",
      battleActive: true,
      scriptOrDialogActive: false,
      dialogVisible: false,
      dialogInputReady: false,
      menuOrTransitionActive: false,
    },
    readiness: {
      observationValid: false,
      inputReady: true,
      playerStable: true,
      controlsLocked: false,
      scriptActive: false,
      dialogVisible: false,
      dialogInputReady: false,
      paletteFading: false,
    },
    battle: {
      typeFlags: 0,
      controllerExecFlags: 0,
      battlersCount: 2,
      inputBattler: 0,
      activeBattler: 0,
      menu: input.menu ?? "action",
      actionCursor: input.actionCursor ?? 0,
      moveCursor: input.moveCursor ?? 0,
      targetBattler: 1,
      currentMove: 0,
      chosenMove: 0,
      moves: [
        {
          slot: 1,
          moveId: 33,
          move: "TACKLE",
          currentPp: 35,
          maxPp: 35,
        },
      ],
      bag: input.bag ?? null,
      party: null,
      battlers: [
        {
          battler: 0,
          side: "player",
          position: 0,
          active: true,
          speciesId: 258,
          species: "Mudkip",
          hp: 20,
          maxHp: 20,
          partyIndex: 0,
          status: 0,
        },
        {
          battler: 1,
          side: "opponent",
          position: 1,
          active: true,
          speciesId: 263,
          species: "Zigzagoon",
          hp: 15,
          maxHp: 15,
          partyIndex: 0,
          status: 0,
        },
      ],
    },
    world: null,
    game: {
      money: 3000,
      registeredItemId: 0,
      inventory: [
        {
          itemId: 4,
          item: "POKé BALL",
          quantity: 5,
          pocket: "poke-balls",
        },
      ],
      progression: {
        hasPokemon: true,
        hasPokedex: true,
        hasPokenav: false,
        runningShoes: false,
        isChampion: false,
        receivedPokedexFromBirch: true,
      },
      party: [
        {
          speciesId: 258,
          species: "Mudkip",
          nickname: "Mudkip",
          level: 5,
          hp: 20,
          maxHp: 20,
          isEgg: false,
        },
      ],
      badges: [],
      pokedexOwned: 1,
      lastCatch: null,
    },
  };
}

class BattlePort {
  readonly presses: CommandInput[] = [];
  private current: GameObservationV2;
  private readonly afterPress: GameObservationV2[];

  constructor(
    initial: GameObservationV2,
    afterPress: readonly GameObservationV2[],
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

  readMapTile(): null {
    return null;
  }
}

describe("GameBattleControl", () => {
  test("selects a named move through action and move cursors", async () => {
    const port = new BattlePort(observation({ frame: 10, actionCursor: 1 }), [
      observation({ frame: 12, actionCursor: 0 }),
      observation({ frame: 14, menu: "move", moveCursor: 2 }),
      observation({ frame: 16, menu: "move", moveCursor: 0 }),
      observation({ frame: 18, actionCursor: 0 }),
    ]);

    const outcome = await new GameBattleControl(port).move({ moveId: 33 });

    expect(outcome.status).toBe("applied");
    expect(outcome.stopReason).toBe("completed");
    expect(port.presses.map((press) => press.command)).toEqual([
      "left",
      "a",
      "up",
      "a",
    ]);
  });

  test("rejects an unavailable item before sending input", async () => {
    const port = new BattlePort(observation({ frame: 10 }), []);

    await expect(new GameBattleControl(port).item(1)).rejects.toThrow(
      "requested item is not present",
    );
    expect(port.presses).toEqual([]);
  });

  test("finds and confirms a named battle item", async () => {
    const port = new BattlePort(observation({ frame: 10 }), [
      observation({ frame: 12, actionCursor: 1 }),
      observation({
        frame: 14,
        menu: "bag",
        actionCursor: 1,
        bag: {
          state: "list",
          pocket: 0,
          position: 0,
          itemId: 13,
          item: "POTION",
        },
      }),
      observation({
        frame: 16,
        menu: "bag",
        actionCursor: 1,
        bag: {
          state: "list",
          pocket: 1,
          position: 0,
          itemId: 3,
          item: "GREAT BALL",
        },
      }),
      observation({
        frame: 18,
        menu: "bag",
        actionCursor: 1,
        bag: {
          state: "list",
          pocket: 1,
          position: 1,
          itemId: 4,
          item: "POKé BALL",
        },
      }),
      observation({
        frame: 20,
        menu: "bag",
        actionCursor: 1,
        bag: {
          state: "use-confirm",
          pocket: 1,
          position: 1,
          itemId: 4,
          item: "POKé BALL",
        },
      }),
      observation({ frame: 22, actionCursor: 0 }),
    ]);

    const outcome = await new GameBattleControl(port).item(4);

    expect(outcome.status).toBe("applied");
    expect(port.presses.map((press) => press.command)).toEqual([
      "right",
      "a",
      "right",
      "down",
      "a",
      "a",
    ]);
  });
});

describe("pokemonctl battle arguments", () => {
  test("resolves exact move and item names into semantic request bodies", async () => {
    const requests: {
      method: string;
      route: string;
      body: Record<string, unknown> | undefined;
    }[] = [];
    const printed: string[] = [];
    const context = {
      request: (
        method: "GET" | "POST",
        route: string,
        body?: Record<string, unknown>,
      ) => {
        requests.push({ method, route, body });
        return Promise.resolve("{}");
      },
      printActionText: (value: string) => {
        printed.push(value);
      },
      readIntegerFlag: (args: string[], name: string) => {
        const index = args.indexOf(name);
        const value = index === -1 ? undefined : args.at(index + 1);
        return value === undefined ? undefined : Number(value);
      },
      readNumberFlag: (args: string[], name: string) => {
        const index = args.indexOf(name);
        const value = index === -1 ? undefined : args.at(index + 1);
        return value === undefined ? undefined : Number(value);
      },
    };

    await handlePokemonctlBattle(context, [
      "move",
      "Tackle",
      "--target-battler",
      "1",
    ]);
    await handlePokemonctlBattle(context, [
      "item",
      "Poké Ball",
      "--party-slot",
      "2",
    ]);

    expect(requests).toEqual([
      {
        method: "POST",
        route: "/battle/move",
        body: { moveId: 33, targetBattler: 1 },
      },
      {
        method: "POST",
        route: "/battle/item",
        body: { itemId: 4, partySlot: 2 },
      },
    ]);
    expect(printed).toEqual(["{}", "{}"]);
  });

  test("rejects an unknown move before making a request", async () => {
    let requestCount = 0;
    const context = {
      request: () => {
        requestCount += 1;
        return Promise.resolve("{}");
      },
      printActionText: () => {
        throw new Error("unexpected battle output");
      },
      readIntegerFlag: () => {
        return;
      },
      readNumberFlag: () => {
        return;
      },
    };

    await expect(
      handlePokemonctlBattle(context, ["move", "Not A Move"]),
    ).rejects.toThrow("unknown move name: Not A Move");
    expect(requestCount).toBe(0);
  });
});
