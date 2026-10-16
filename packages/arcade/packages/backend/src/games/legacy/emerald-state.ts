import {
  PokemonStateSchema,
  type PokemonState,
} from "@arcade/common/telemetry.ts";
import type { GameStateReading } from "@discord-plays-pokemon/backend/game/state-view.ts";

/** Project the legacy reader onto Arcade's public telemetry contract. */
export function toArcadePokemonState(
  reading: GameStateReading,
  goal: PokemonState["goal"],
): PokemonState {
  return PokemonStateSchema.parse({
    ...reading,
    family: "pokemon",
    party: reading.party.map(
      ({ species, nickname, level, hp, maxHp, isEgg }) => ({
        species,
        nickname,
        level,
        hp,
        maxHp,
        isEgg,
      }),
    ),
    goal,
  });
}
