import { games, type GameId } from "@arcade/common/catalog.ts";
import type { GameClientModule } from "./module.ts";
import { Mk64Page, WiiPage } from "./racing.tsx";
import { MeleePage, BrawlPage } from "./fighting.tsx";
import { EmeraldPage } from "./emerald.tsx";

export const clientModules = {
  mk64: {
    definition: games.mk64,
    subtitle: "Four friends. One starting line.",
    mark: "64",
    Page: Mk64Page,
  },
  emerald: {
    definition: games.emerald,
    subtitle: "One adventure. Everyone plays.",
    mark: "E",
    Page: EmeraldPage,
  },
  mkwii: {
    definition: games.mkwii,
    subtitle: "A little friendly competition.",
    mark: "Wii",
    Page: WiiPage,
  },
  melee: {
    definition: games.melee,
    subtitle: "Ready for the next challenger?",
    mark: "M",
    Page: MeleePage,
  },
  brawl: {
    definition: games.brawl,
    subtitle: "Bring the whole crew.",
    mark: "B",
    Page: BrawlPage,
  },
} as const satisfies Record<GameId, GameClientModule>;
