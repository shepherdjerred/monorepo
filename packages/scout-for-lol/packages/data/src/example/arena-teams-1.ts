import { type ArenaTeam, type Augment } from "@scout-for-lol/data";
import {
  createAatroxChampion,
  createLeonaChampion,
} from "./arena-factories.ts";

export function getTeam1(
  masterAugment: Augment,
  courageAugment: Augment,
): ArenaTeam {
  return {
    teamId: 1 as const,
    placement: 2 as const,
    players: [
      createAatroxChampion(Array.from({ length: 6 }, () => masterAugment)),
      createLeonaChampion(Array.from({ length: 6 }, () => courageAugment)),
    ],
  };
}
