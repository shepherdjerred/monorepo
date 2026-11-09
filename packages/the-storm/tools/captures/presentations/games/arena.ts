import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "mob-arena-classes",
    alt: "The preserved Colosseum's underground lobby has its real class signs and ready block.",
    caption: "Choose a class in the Colosseum lobby before readying up.",
    annotations: [],
  },
  {
    schema: 1,
    name: "mob-arena-knight-kit",
    alt: "The actual starter Knight kit appears in the player's arena inventory.",
    caption:
      "Knight starts with close-range equipment; arena gear stays inside the arena.",
    annotations: [],
  },
  {
    schema: 1,
    name: "mob-arena-wave",
    alt: "The first actual Mob Arena wave begins on the preserved Colosseum floor.",
    caption: "Ready up to enter the arena and face its waves with your group.",
    annotations: [],
  },
  {
    schema: 1,
    name: "mob-arena-spectator",
    alt: "A spectator watches an active Colosseum game from the preserved balcony.",
    caption:
      "Use /arena spec colosseum to watch a game without joining the fight.",
    annotations: [],
  },
] satisfies Presentation[];
