import type { GameEvent } from "./types.ts";
import { nationalDexName, speciesName } from "./generated/species.ts";
import { BADGES } from "./data/badges.ts";

/** How every transport (Discord embeds, the web feed) words a game event. */
export type GameEventDescription = {
  readonly title: string;
  /** Markdown-free prose, e.g. "Caught Zigzagoon!". */
  readonly text: string;
};

// Display names are stored uppercase (BULBASAUR); title-case for prose.
export function titleCase(name: string): string {
  return name.replaceAll(/[A-Z]+/gi, (word) => {
    const first = word[0];
    return first === undefined ? word : first + word.slice(1).toLowerCase();
  });
}

export function describeGameEvent(event: GameEvent): GameEventDescription {
  switch (event.kind) {
    case "faint":
      return {
        title: "💀 Fainted",
        text: `${titleCase(speciesName(event.species))} (Lv. ${String(event.level)}) fainted.`,
      };
    case "whiteout":
      return {
        title: "⬜ Whiteout",
        text: "The whole party fainted — blacked out!",
      };
    case "badge": {
      // badgeIndex is always 0-7 (the diff iterates the 8 badge flags).
      const badge = BADGES[event.badgeIndex];
      if (badge === undefined) {
        throw new Error(
          `Badge index out of range: ${String(event.badgeIndex)}`,
        );
      }
      return {
        title: "🏅 Badge earned",
        text: `Earned the ${badge.name} — ${badge.leader}, ${badge.city}.`,
      };
    }
    case "evolution":
      return {
        title: "✨ Evolution",
        text: `${titleCase(speciesName(event.fromSpecies))} evolved into ${titleCase(speciesName(event.toSpecies))}!`,
      };
    case "catch":
      return {
        title: "🎯 Caught a Pokémon",
        text: `Caught ${titleCase(speciesName(event.species))}!${event.shiny ? " ✨ Shiny!" : ""}`,
      };
    case "levelUp":
      return {
        title: "⬆️ Level up",
        text: `${titleCase(speciesName(event.species))} grew from Lv. ${String(event.fromLevel)} to Lv. ${String(event.toLevel)}.`,
      };
    case "dexEntry": {
      const name = nationalDexName(event.nationalDexNumber);
      return {
        title: "📖 New Pokédex entry",
        text: `#${String(event.nationalDexNumber)}${name === undefined ? "" : ` ${titleCase(name)}`} registered.`,
      };
    }
  }
}
