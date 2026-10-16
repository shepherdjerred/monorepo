import { expect, test } from "vitest";
import type { GameStateReading } from "@discord-plays-pokemon/backend/game/state-view.ts";
import { toArcadePokemonState } from "#src/games/legacy/emerald-state.ts";

test("publishes a populated Emerald party from the retained game reader", () => {
  const reading: GameStateReading = {
    phase: "overworld",
    location: "Littleroot Town",
    party: [
      {
        species: "Treecko",
        nationalDexNumber: 252,
        nickname: "Basil",
        level: 5,
        hp: 19,
        maxHp: 20,
        isEgg: false,
      },
      {
        species: "Egg",
        nationalDexNumber: null,
        nickname: "Egg",
        level: 1,
        hp: 0,
        maxHp: 1,
        isEgg: true,
      },
    ],
    badges: [false, false, false, false, false, false, false, false],
    pokedexOwned: 1,
    money: 3000,
  };
  const goal = { goal: "Explore Littleroot", status: "running" };
  const state = toArcadePokemonState(reading, goal);
  expect(state).toEqual({
    ...reading,
    family: "pokemon",
    party: [
      {
        species: "Treecko",
        nickname: "Basil",
        level: 5,
        hp: 19,
        maxHp: 20,
        isEgg: false,
      },
      {
        species: "Egg",
        nickname: "Egg",
        level: 1,
        hp: 0,
        maxHp: 1,
        isEgg: true,
      },
    ],
    goal,
  });
});
