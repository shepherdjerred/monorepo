import { games, type GameId } from "@arcade/common/catalog.ts";
import type { GameClientModule } from "./module.ts";
import { Mk64Room } from "./mk64-room.tsx";
import { EmeraldRoom } from "./emerald-room.tsx";
import { WiiRoom } from "./wii-room.tsx";
import { MeleeRoom } from "./melee-room.tsx";
import { BrawlRoom } from "./brawl-room.tsx";

export const clientModules = {
  mk64: {
    definition: games.mk64,
    subtitle: "Four friends. One starting line.",
    mark: "64",
    Room: Mk64Room,
  },
  emerald: {
    definition: games.emerald,
    subtitle: "One adventure. Everyone plays.",
    mark: "E",
    Room: EmeraldRoom,
  },
  mkwii: {
    definition: games.mkwii,
    subtitle: "A little friendly competition.",
    mark: "Wii",
    Room: WiiRoom,
  },
  melee: {
    definition: games.melee,
    subtitle: "Ready for the next challenger?",
    mark: "M",
    Room: MeleeRoom,
  },
  brawl: {
    definition: games.brawl,
    subtitle: "Bring the whole crew.",
    mark: "B",
    Room: BrawlRoom,
  },
} as const satisfies Record<GameId, GameClientModule>;
