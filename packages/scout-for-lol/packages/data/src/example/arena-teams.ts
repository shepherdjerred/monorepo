import { type ArenaTeam } from "@scout-for-lol/data";
import {
  createMasterOfDualityAugment,
  createCourageAugment,
} from "./arena-augments.ts";
import { getTeam1 } from "./arena-teams-1.ts";
import { getTeam2 } from "./arena-teams-2.ts";
import { getTeam3 } from "./arena-teams-3.ts";
import { getTeam4 } from "./arena-teams-4.ts";
import { getTeam5 } from "./arena-teams-5.ts";
import { getTeam6 } from "./arena-teams-6.ts";
import { getTeam7 } from "./arena-teams-7.ts";
import { getTeam8 } from "./arena-teams-8.ts";

export function getTeams() {
  const masterAugment = createMasterOfDualityAugment();
  const courageAugment = createCourageAugment();

  return [
    getTeam1(masterAugment, courageAugment),
    getTeam2(),
    getTeam3(),
    getTeam4(),
    getTeam5(),
    getTeam6(),
    getTeam7(),
    getTeam8(),
  ] satisfies ArenaTeam[];
}
