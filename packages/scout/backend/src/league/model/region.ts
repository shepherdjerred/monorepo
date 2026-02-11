import { Regions } from "twisted/dist/constants/index.js";
import { match } from "ts-pattern";
import type { Region } from "@shepherdjerred/scout-data";

export function mapRegionToEnum(region: Region): Regions {
  return match(region)
    .with("BRAZIL", () => Regions.BRAZIL)
    .with("EU_EAST", () => Regions.EU_EAST)
    .with("EU_WEST", () => Regions.EU_WEST)
    .with("KOREA", () => Regions.KOREA)
    .with("LAT_NORTH", () => Regions.LAT_NORTH)
    .with("LAT_SOUTH", () => Regions.LAT_SOUTH)
    .with("AMERICA_NORTH", () => Regions.AMERICA_NORTH)
    .with("OCEANIA", () => Regions.OCEANIA)
    .with("TURKEY", () => Regions.TURKEY)
    .with("RUSSIA", () => Regions.RUSSIA)
    .with("JAPAN", () => Regions.JAPAN)
    .with("VIETNAM", () => Regions.VIETNAM)
    .with("TAIWAN", () => Regions.TAIWAN)
    .with("SINGAPORE", () => Regions.SINGAPORE)
    .with("PBE", () => Regions.PBE)
    .exhaustive();
}
