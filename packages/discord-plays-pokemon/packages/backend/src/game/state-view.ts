// The game as the web page shows it: a compact, display-ready read of the save
// and the engine. Built from the same readers the event watcher and the goal
// agent use, so every view of the game agrees.
import type { GameStateView } from "@discord-plays-pokemon/common";
import type { Emulator } from "#src/emulator/emulator.ts";
import { readGameSnapshot } from "#src/game/events/snapshot.ts";
import { speciesName } from "#src/game/events/generated/species.ts";
import { titleCase } from "#src/game/events/describe.ts";
import { readGameSaveDetails } from "#src/game/game-save-details.ts";
import { mapName } from "#src/game/spatial/generated/map-names.ts";
import { countDexOwned } from "#src/game/pokedex.ts";
import { nationalDexNumber } from "#src/game/events/national-dex.ts";

const BADGE_COUNT = 8;

/** Everything but the goal, which the session (not the game) owns. */
export type GameStateReading = Omit<GameStateView, "goal">;

export function readGameStateView(emulator: Emulator): GameStateReading {
  const engine = emulator.engineObservation();
  const reader = emulator.memoryReader();
  const symbols = emulator.gameSymbols();
  const snapshot = readGameSnapshot(reader, symbols);
  const details = readGameSaveDetails(reader, symbols);

  const badges = Array.from(
    { length: BADGE_COUNT },
    (_unused, index) => snapshot?.badges[index] === true,
  );

  return {
    phase: engine.phase,
    location:
      engine.world === null
        ? null
        : mapName(engine.world.mapGroup, engine.world.mapNum),
    party:
      snapshot?.party.map((mon) => ({
        species: mon.isEgg ? "Egg" : titleCase(speciesName(mon.species)),
        nationalDexNumber: mon.isEgg ? null : nationalDexNumber(mon.species),
        nickname: mon.nickname,
        level: mon.level,
        hp: mon.hp,
        maxHp: mon.maxHp,
        isEgg: mon.isEgg,
      })) ?? [],
    badges,
    pokedexOwned: snapshot === null ? 0 : countDexOwned(snapshot.dexOwned),
    money: details?.money ?? null,
  };
}
