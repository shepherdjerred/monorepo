import type { Presentation } from "@shepherdjerred/mc-harness/protocol/media.ts";
export default [
  {
    schema: 1,
    name: "starter-compass",
    alt: "The genuine starter compass opens the server's biome chooser.",
    caption:
      "Right-click the starter compass to choose a biome for a wilderness trip.",
    annotations: [],
  },
  {
    schema: 1,
    name: "welcome-guide",
    alt: "The Storm's welcome book explains the first steps on the server.",
    caption: "Use /guide to reopen the welcome book.",
    annotations: [],
  },
  {
    schema: 1,
    name: "worlds-menu",
    alt: "The Travel menu offers Frontier, Skylands, and Main Map 2.",
    caption:
      "Use /worlds to choose an available world, and /spawn to return to main spawn.",
    annotations: [],
  },
] satisfies Presentation[];
