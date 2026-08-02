import { expect, test } from "bun:test";
import {
  formatPokemonctlActionOutput,
  formatPokemonctlObservationOutput,
} from "./pokemonctl-output.ts";

const battle = {
  typeFlags: 1,
  controllerExecFlags: 4,
  battlersCount: 4,
  inputBattler: 2,
  activeBattler: 2,
  menu: "move",
  actionCursor: 0,
  moveCursor: 2,
  targetBattler: 1,
  currentMove: 33,
  chosenMove: 0,
  switchAllowed: true,
  moves: [
    {
      slot: 1,
      moveId: 33,
      move: "TACKLE",
      currentPp: 35,
      maxPp: 35,
      usable: true,
    },
  ],
  bag: null,
  party: null,
  battlers: [
    {
      battler: 2,
      side: "player",
      position: 0,
      active: true,
      speciesId: 283,
      species: "Mudkip",
      hp: 18,
      maxHp: 20,
      partyIndex: 0,
      status: 0,
    },
  ],
};

const world = {
  map: "Route 103",
  mapGroup: 0,
  mapNum: 16,
  x: 8,
  y: 11,
  facing: "north",
  movementMode: "on foot",
  onTileBehavior: "tall grass",
  collision: { north: { code: 0, passable: true } },
  nearby: [{ kind: "npc", dx: 1, dy: 0 }],
};

function observation(frame: number) {
  return {
    schemaVersion: 2,
    id: `observation-v2:${String(frame)}`,
    frame,
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
      observationValid: true,
      inputReady: true,
      playerStable: true,
      controlsLocked: false,
      scriptActive: false,
      dialogVisible: false,
      dialogInputReady: false,
      paletteFading: false,
    },
    world,
    battle,
    game: {
      money: 3000,
      registeredItemId: 0,
      inventory: [
        { itemId: 4, item: "POKé BALL", quantity: 5, pocket: "poke-balls" },
      ],
      party: [
        {
          speciesId: 283,
          species: "Mudkip",
          nickname: "Mudkip",
          level: 5,
          hp: 18,
          maxHp: 20,
          isEgg: false,
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
      badges: [],
      pokedexOwned: 1,
      lastCatch: null,
    },
  };
}

test("observe output is compact by default and preserves full diagnostics", () => {
  const responseText = JSON.stringify({
    ...observation(20),
    screenshot: {
      path: "/tmp/pokemon.png",
      frame: 20,
    },
  });

  const compactText = formatPokemonctlObservationOutput(responseText, false);
  const compact = JSON.parse(compactText);
  expect(compact.context).toBe("battle");
  expect(compact.inputReady).toBe(true);
  expect(compact.map).toBe("Route 103");
  expect(compact.movementMode).toBe("on foot");
  expect(compact.onTileBehavior).toBe("tall grass");
  expect(compact.battle.inputBattler).toBe(2);
  expect(compact.battle.moveCursor).toBe(2);
  expect(compact.battle.battlers).toEqual(battle.battlers);
  expect(compact.game.inventory).toEqual([
    {
      itemId: 4,
      item: "POKé BALL",
      quantity: 5,
      pocket: "poke-balls",
    },
  ]);
  expect(compact.game.party[0]).toEqual({
    speciesId: 283,
    species: "Mudkip",
    nickname: "Mudkip",
    level: 5,
    hp: 18,
    maxHp: 20,
    isEgg: false,
  });
  expect(compact.game.progression.receivedPokedexFromBirch).toBe(true);
  expect(compact.game.pokedexOwned).toBe(1);
  expect(compact.screenshot).toEqual({
    path: "/tmp/pokemon.png",
    frame: 20,
  });
  expect(compact.readiness).toBeUndefined();
  expect(compact.world).toBeUndefined();
  expect(compactText.length).toBeLessThan(responseText.length);
  expect(formatPokemonctlObservationOutput(responseText, true)).toBe(
    responseText,
  );
});

test("keeps semantic verification evidence compact by default", () => {
  const responseText = JSON.stringify({
    schemaVersion: 1,
    action: "tap:down",
    status: "applied",
    stopReason: "completed",
    inputApplied: true,
    framesElapsed: 2,
    tilesMoved: 0,
    attemptsMade: 2,
    stepsTaken: 1,
    mapChanged: false,
    facingChanged: false,
    phaseChanged: false,
    battleChanged: true,
    stateChanged: true,
    visualChanged: true,
    visualChangeRatio: 0.004321,
    before: observation(10),
    after: {
      ...observation(12),
      battle: {
        ...battle,
        controllerExecFlags: 2,
        actionCursor: 1,
      },
    },
  });

  const compactText = formatPokemonctlActionOutput(responseText, false);
  const compact = JSON.parse(compactText);
  expect(compact.status).toBe("applied");
  expect(compact.attemptsMade).toBe(2);
  expect(compact.stepsTaken).toBe(1);
  expect(compact.battleChanged).toBe(true);
  expect(compact.visualChangeRatio).toBe(0.0043);
  expect(compact.before.map).toBe("Route 103");
  expect(compact.before.battle.actionCursor).toBe(0);
  expect(compact.after.battle.actionCursor).toBe(1);
  expect(compact.after.battle.battlers).toEqual(battle.battlers);
  expect(compact.after.game.inventory).toHaveLength(1);
  expect(compact.delta.battleDecision).toEqual({
    before: {
      typeFlags: 1,
      controllerExecFlags: 4,
      battlersCount: 4,
      inputBattler: 2,
      activeBattler: 2,
      menu: "move",
      actionCursor: 0,
      moveCursor: 2,
      targetBattler: 1,
      currentMove: 33,
      chosenMove: 0,
      switchAllowed: true,
      moves: battle.moves,
      bag: null,
      party: null,
    },
    after: {
      typeFlags: 1,
      controllerExecFlags: 2,
      battlersCount: 4,
      inputBattler: 2,
      activeBattler: 2,
      menu: "move",
      actionCursor: 1,
      moveCursor: 2,
      targetBattler: 1,
      currentMove: 33,
      chosenMove: 0,
      switchAllowed: true,
      moves: battle.moves,
      bag: null,
      party: null,
    },
  });
  expect(compact.before.world).toBeUndefined();
  expect(compact.before.game).toBeUndefined();
  expect(compactText.length).toBeLessThan(responseText.length);
  expect(formatPokemonctlActionOutput(responseText, true)).toBe(responseText);
});
