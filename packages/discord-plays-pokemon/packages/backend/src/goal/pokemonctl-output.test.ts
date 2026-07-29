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
  currentMove: 33,
  chosenMove: 0,
  battlers: [{ battler: 2, species: "Mudkip" }],
};

const world = {
  map: "Route 103",
  mapGroup: 0,
  mapNum: 16,
  x: 8,
  y: 11,
  facing: "north",
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
      inventory: [{ itemId: 4, quantity: 5 }],
      party: [{ species: "Mudkip" }],
      progression: { hasPokedex: true },
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
  expect(compact.battle.inputBattler).toBe(2);
  expect(compact.battle.moveCursor).toBe(2);
  expect(compact.screenshot).toEqual({
    path: "/tmp/pokemon.png",
    frame: 20,
  });
  expect(compact.readiness).toBeUndefined();
  expect(compact.world).toBeUndefined();
  expect(compact.game).toBeUndefined();
  expect(compact.battle.battlers).toBeUndefined();
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
  expect(compact.battleChanged).toBe(true);
  expect(compact.visualChangeRatio).toBe(0.0043);
  expect(compact.before.map).toBe("Route 103");
  expect(compact.before.battle.actionCursor).toBe(0);
  expect(compact.after.battle.actionCursor).toBe(1);
  expect(compact.before.world).toBeUndefined();
  expect(compact.before.game).toBeUndefined();
  expect(compactText.length).toBeLessThan(responseText.length);
  expect(formatPokemonctlActionOutput(responseText, true)).toBe(responseText);
});
