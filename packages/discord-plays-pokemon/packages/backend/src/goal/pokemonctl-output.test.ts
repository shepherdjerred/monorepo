import { expect, test } from "bun:test";
import { formatPokemonctlObservationOutput } from "./pokemonctl-output.ts";

test("observe output is compact by default and preserves full diagnostics", () => {
  const responseText = JSON.stringify({
    schemaVersion: 2,
    id: "observation-v2:20",
    frame: 20,
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
    world: {
      map: "Route 103",
      mapGroup: 0,
      mapNum: 16,
      x: 8,
      y: 11,
      facing: "north",
      collision: { north: { code: 0, passable: true } },
      nearby: [{ kind: "npc", dx: 1, dy: 0 }],
    },
    battle: {
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
    },
    game: {
      money: 3000,
      inventory: [{ itemId: 4, quantity: 5 }],
      party: [{ species: "Mudkip" }],
      progression: { hasPokedex: true },
    },
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
  expect(compact.battle.activeBattler).toBe(2);
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
