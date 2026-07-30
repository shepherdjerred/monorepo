import { describe, expect, test } from "bun:test";
import type { CommandInput } from "#src/game/command/command-input.ts";
import { GameBattleControl } from "./game-battle-control.ts";
import { requireBattleItemSelection } from "./game-battle-control-rules.ts";
import type { GameObservationV2 } from "./game-observation.ts";
import { handlePokemonctlBattle } from "./pokemonctl-battle.ts";

type BattleState = NonNullable<GameObservationV2["battle"]>;
type GameState = NonNullable<GameObservationV2["game"]>;

type BattleInput = Readonly<{
  frame: number;
  menu?: BattleState["menu"];
  typeFlags?: number;
  actionCursor?: number;
  moveCursor?: number;
  targetBattler?: number | null;
  moves?: BattleState["moves"];
  switchAllowed?: boolean;
  bag?: BattleState["bag"];
  battleParty?: BattleState["party"];
  battlers?: BattleState["battlers"];
  inventory?: GameState["inventory"];
  gameParty?: GameState["party"];
}>;

type BattlePortOptions = Readonly<{
  partyItemApplicable?: boolean;
  directItemApplicable?: boolean;
  runAllowed?: boolean;
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
      typeFlags: input.typeFlags ?? 0,
      controllerExecFlags: 0,
      battlersCount: input.battlers?.length ?? 2,
      inputBattler: 0,
      activeBattler: 0,
      menu: input.menu ?? "action",
      actionCursor: input.actionCursor ?? 0,
      moveCursor: input.moveCursor ?? 0,
      targetBattler:
        input.targetBattler === undefined ? 1 : input.targetBattler,
      currentMove: 0,
      chosenMove: 0,
      switchAllowed: input.switchAllowed ?? true,
      moves: input.moves ?? [
        {
          slot: 1,
          moveId: 33,
          move: "TACKLE",
          currentPp: 35,
          maxPp: 35,
          usable: true,
        },
      ],
      bag: input.bag ?? null,
      party: input.battleParty ?? null,
      battlers: input.battlers ?? [
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
      inventory: input.inventory ?? [
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
      party: input.gameParty ?? [
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
  private readonly itemApplicable: boolean;
  private readonly directItemApplicable: boolean;
  private readonly runAllowed: boolean;

  constructor(
    initial: GameObservationV2,
    afterPress: readonly GameObservationV2[],
    options: BattlePortOptions = {},
  ) {
    this.current = initial;
    this.afterPress = [...afterPress];
    this.itemApplicable = options.partyItemApplicable ?? true;
    this.directItemApplicable = options.directItemApplicable ?? true;
    this.runAllowed = options.runAllowed ?? true;
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

  canUseBattleItemOnPartyMon(): boolean {
    return this.itemApplicable;
  }

  canUseBattleItemOnBattler(): boolean {
    return this.directItemApplicable;
  }

  canRunFromBattle(): boolean {
    return this.runAllowed;
  }
}

function expectEngineConfirmedReviveTarget(): void {
  const current = observation({
    frame: 10,
    inventory: [
      {
        itemId: 24,
        item: "REVIVE",
        quantity: 1,
        pocket: "items",
      },
    ],
    gameParty: [
      {
        speciesId: 258,
        species: "Mudkip",
        nickname: "Mudkip",
        level: 5,
        hp: 0,
        maxHp: 20,
        isEgg: false,
      },
    ],
  });
  const battle = current.battle;
  if (battle === null) throw new Error("test observation has no battle");

  expect(
    requireBattleItemSelection(current, battle, 24, {
      partySlot: 1,
      canUseOnBattler: () => false,
      canUseOnPartyMon: (itemId, partySlot) => itemId === 24 && partySlot === 1,
    }),
  ).toEqual({
    inventoryItem: {
      itemId: 24,
      item: "REVIVE",
      quantity: 1,
      pocket: "items",
    },
    pocket: 0,
  });
}

describe("GameBattleControl move actions", () => {
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

  test("rejects an explicit target when the move cannot open a target menu", async () => {
    const port = new BattlePort(observation({ frame: 10 }), []);

    await expect(
      new GameBattleControl(port).move({
        moveId: 33,
        targetBattler: 0,
      }),
    ).rejects.toThrow(
      "requested move does not expose a selectable target in this battle",
    );
    expect(port.presses).toEqual([]);
  });

  test("rejects a battle-limited move before sending input", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        moves: [
          {
            slot: 1,
            moveId: 33,
            move: "TACKLE",
            currentPp: 35,
            maxPp: 35,
            usable: false,
          },
        ],
      }),
      [],
    );

    await expect(
      new GameBattleControl(port).move({ moveId: 33 }),
    ).rejects.toThrow("requested move is currently disabled by battle rules");
    expect(port.presses).toEqual([]);
  });

  test("rejects a target the pending move cannot select before sending input", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        menu: "target",
        typeFlags: 1,
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
          {
            battler: 2,
            side: "player",
            position: 2,
            active: true,
            speciesId: 252,
            species: "Treecko",
            hp: 19,
            maxHp: 19,
            partyIndex: 1,
            status: 0,
          },
        ],
      }),
      [],
    );

    await expect(new GameBattleControl(port).target(0)).rejects.toThrow(
      "requested move cannot target its input battler",
    );
    expect(port.presses).toEqual([]);
  });

  test("applies an explicit selectable target in a double battle", async () => {
    const battlers: BattleState["battlers"] = [
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
      {
        battler: 2,
        side: "player",
        position: 2,
        active: true,
        speciesId: 252,
        species: "Treecko",
        hp: 19,
        maxHp: 19,
        partyIndex: 1,
        status: 0,
      },
      {
        battler: 3,
        side: "opponent",
        position: 3,
        active: true,
        speciesId: 261,
        species: "Poochyena",
        hp: 14,
        maxHp: 14,
        partyIndex: 1,
        status: 0,
      },
    ];
    const port = new BattlePort(
      observation({ frame: 10, typeFlags: 1, battlers }),
      [
        observation({
          frame: 12,
          menu: "move",
          typeFlags: 1,
          battlers,
        }),
        observation({
          frame: 14,
          menu: "target",
          typeFlags: 1,
          targetBattler: 1,
          battlers,
        }),
        observation({
          frame: 16,
          menu: "target",
          typeFlags: 1,
          targetBattler: 3,
          battlers,
        }),
        observation({
          frame: 18,
          typeFlags: 1,
          targetBattler: 3,
          battlers,
        }),
      ],
    );

    const outcome = await new GameBattleControl(port).move({
      moveId: 33,
      targetBattler: 3,
    });

    expect(outcome.status).toBe("applied");
    expect(port.presses.map((press) => press.command)).toEqual([
      "a",
      "a",
      "right",
      "a",
    ]);
  });
});

describe("GameBattleControl party actions", () => {
  test("rejects a trapped switch before sending input", async () => {
    const gameParty: GameState["party"] = [
      {
        speciesId: 258,
        species: "Mudkip",
        nickname: "Mudkip",
        level: 5,
        hp: 20,
        maxHp: 20,
        isEgg: false,
      },
      {
        speciesId: 252,
        species: "Treecko",
        nickname: "Treecko",
        level: 5,
        hp: 19,
        maxHp: 19,
        isEgg: false,
      },
    ];
    const port = new BattlePort(
      observation({ frame: 10, gameParty, switchAllowed: false }),
      [],
    );

    await expect(new GameBattleControl(port).switch(2)).rejects.toThrow(
      "the input battler is currently prevented from switching",
    );
    expect(port.presses).toEqual([]);
  });

  test("selects an input-ready forced replacement without reopening the party", async () => {
    const gameParty: GameState["party"] = [
      {
        speciesId: 258,
        species: "Mudkip",
        nickname: "Mudkip",
        level: 5,
        hp: 0,
        maxHp: 20,
        isEgg: false,
      },
      {
        speciesId: 252,
        species: "Treecko",
        nickname: "Treecko",
        level: 5,
        hp: 19,
        maxHp: 19,
        isEgg: false,
      },
    ];
    const initial = observation({
      frame: 10,
      menu: "party",
      switchAllowed: false,
      battleParty: {
        inputReady: true,
        slot: 0,
        layout: 0,
        action: 1,
      },
      gameParty,
    });
    const port = new BattlePort(initial, [
      observation({
        frame: 12,
        menu: "party",
        battleParty: {
          inputReady: true,
          slot: 1,
          layout: 0,
          action: 1,
        },
        gameParty,
      }),
      observation({
        frame: 14,
        menu: "party",
        battleParty: {
          inputReady: false,
          slot: 6,
          layout: 0,
          action: 1,
        },
        gameParty,
      }),
      observation({ frame: 16, actionCursor: 0, gameParty }),
    ]);

    const outcome = await new GameBattleControl(port).switch(2);

    expect(outcome.status).toBe("applied");
    expect(port.presses.map((press) => press.command)).toEqual([
      "down",
      "a",
      "a",
    ]);
  });

  test("rejects a non-replacement party decision before sending input", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        menu: "party",
        battleParty: {
          inputReady: true,
          slot: 0,
          layout: 0,
          action: 3,
        },
      }),
      [],
    );

    await expect(new GameBattleControl(port).switch(1)).rejects.toThrow(
      "forced replacement requires an input-ready Send Out party decision",
    );
    expect(port.presses).toEqual([]);
  });

  test("confirms Shift after selecting a voluntary switch target", async () => {
    const gameParty: GameState["party"] = [
      {
        speciesId: 258,
        species: "Mudkip",
        nickname: "Mudkip",
        level: 5,
        hp: 20,
        maxHp: 20,
        isEgg: false,
      },
      {
        speciesId: 252,
        species: "Treecko",
        nickname: "Treecko",
        level: 5,
        hp: 19,
        maxHp: 19,
        isEgg: false,
      },
    ];
    const port = new BattlePort(observation({ frame: 10, gameParty }), [
      observation({ frame: 12, actionCursor: 2, gameParty }),
      observation({
        frame: 14,
        menu: "party",
        battleParty: {
          inputReady: true,
          slot: 0,
          layout: 0,
          action: 0,
        },
        gameParty,
      }),
      observation({
        frame: 16,
        menu: "party",
        battleParty: {
          inputReady: true,
          slot: 1,
          layout: 0,
          action: 0,
        },
        gameParty,
      }),
      observation({
        frame: 18,
        menu: "party",
        battleParty: {
          inputReady: false,
          slot: 6,
          layout: 0,
          action: 0,
        },
        gameParty,
      }),
      observation({ frame: 20, actionCursor: 0, gameParty }),
    ]);

    const outcome = await new GameBattleControl(port).switch(2);

    expect(outcome.status).toBe("applied");
    expect(port.presses.map((press) => press.command)).toEqual([
      "down",
      "a",
      "down",
      "a",
      "a",
    ]);
  });
});

describe("GameBattleControl run actions", () => {
  test("rejects Run in a trainer battle before sending input", async () => {
    const port = new BattlePort(
      observation({ frame: 10, typeFlags: 1 << 3 }),
      [],
    );

    await expect(new GameBattleControl(port).run()).rejects.toThrow(
      "cannot run from a trainer battle",
    );
    expect(port.presses).toEqual([]);
  });

  test("rejects Run while the input battler is trapped before sending input", async () => {
    const port = new BattlePort(observation({ frame: 10 }), [], {
      runAllowed: false,
    });

    await expect(new GameBattleControl(port).run()).rejects.toThrow(
      "the input battler is currently prevented from running",
    );
    expect(port.presses).toEqual([]);
  });
});

describe("GameBattleControl item actions", () => {
  test("rejects an unavailable item before sending input", async () => {
    const port = new BattlePort(observation({ frame: 10 }), []);

    await expect(new GameBattleControl(port).item(1)).rejects.toThrow(
      "requested item is not present",
    );
    expect(port.presses).toEqual([]);
  });

  test("requires a recipient for a party-targeted item before input", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        inventory: [
          {
            itemId: 13,
            item: "POTION",
            quantity: 1,
            pocket: "items",
          },
        ],
      }),
      [],
    );

    await expect(new GameBattleControl(port).item(13)).rejects.toThrow(
      "requested item requires a party slot",
    );
    expect(port.presses).toEqual([]);
  });

  test("rejects a PP item that needs an unprovided move choice", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        inventory: [
          {
            itemId: 34,
            item: "ETHER",
            quantity: 1,
            pocket: "items",
          },
        ],
      }),
      [],
    );

    await expect(new GameBattleControl(port).item(34, 1)).rejects.toThrow(
      "requested item requires a move choice",
    );
    expect(port.presses).toEqual([]);
  });

  test("rejects medicine with no effect before opening the Bag", async () => {
    for (const item of [
      { itemId: 13, item: "POTION" },
      { itemId: 14, item: "ANTIDOTE" },
    ]) {
      const port = new BattlePort(
        observation({
          frame: 10,
          inventory: [
            {
              ...item,
              quantity: 1,
              pocket: "items",
            },
          ],
        }),
        [],
        { partyItemApplicable: false },
      );

      await expect(
        new GameBattleControl(port).item(item.itemId, 1),
      ).rejects.toThrow(
        "requested item has no effect on the requested party slot",
      );
      expect(port.presses).toEqual([]);
    }
  });

  test("rejects an inapplicable direct battle item before opening the Bag", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        inventory: [
          {
            itemId: 75,
            item: "X ATTACK",
            quantity: 1,
            pocket: "items",
          },
        ],
      }),
      [],
      { directItemApplicable: false },
    );

    await expect(new GameBattleControl(port).item(75)).rejects.toThrow(
      "requested item has no effect on the input battler",
    );
    expect(port.presses).toEqual([]);
  });

  test(
    "allows an engine-confirmed Revive target to be fainted",
    expectEngineConfirmedReviveTarget,
  );

  test("rejects a Poké Ball in a trainer battle before input", async () => {
    const port = new BattlePort(
      observation({ frame: 10, typeFlags: 1 << 3 }),
      [],
    );

    await expect(new GameBattleControl(port).item(4)).rejects.toThrow(
      "Poké Balls cannot be used in trainer battles",
    );
    expect(port.presses).toEqual([]);
  });

  test("rejects an escape item in a trainer battle before input", async () => {
    const port = new BattlePort(
      observation({
        frame: 10,
        typeFlags: 1 << 3,
        inventory: [
          {
            itemId: 80,
            item: "POKé DOLL",
            quantity: 1,
            pocket: "items",
          },
        ],
      }),
      [],
    );

    await expect(new GameBattleControl(port).item(80)).rejects.toThrow(
      "escape items cannot be used in trainer battles",
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
    };

    await expect(
      handlePokemonctlBattle(context, ["move", "Not A Move"]),
    ).rejects.toThrow("unknown move name: Not A Move");
    expect(requestCount).toBe(0);
  });

  test("rejects a non-integer party slot before making a request", async () => {
    for (const rawPartySlot of ["1.5", "2junk"]) {
      let requestCount = 0;
      const context = {
        request: () => {
          requestCount += 1;
          return Promise.resolve("{}");
        },
        printActionText: () => {
          throw new Error("unexpected battle output");
        },
        readIntegerFlag: (args: string[], name: string) => {
          const index = args.indexOf(name);
          const raw = index === -1 ? undefined : args.at(index + 1);
          if (raw === undefined) return;
          const value = Number(raw);
          if (!Number.isInteger(value)) {
            throw new TypeError(`${name} must be an integer`);
          }
          return value;
        },
      };

      await expect(
        handlePokemonctlBattle(context, [
          "item",
          "Potion",
          "--party-slot",
          rawPartySlot,
        ]),
      ).rejects.toThrow("--party-slot must be an integer");
      expect(requestCount).toBe(0);
    }
  });
});
