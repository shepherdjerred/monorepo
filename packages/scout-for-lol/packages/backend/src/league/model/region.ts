import { Constants } from "twisted";
import { match } from "ts-pattern";
import type { Region } from "@scout-for-lol/data";

type RegionEnum = (typeof Constants.Regions)[keyof typeof Constants.Regions];

export function mapRegionToEnum(region: Region): RegionEnum {
  return match(region)
    .with("BRAZIL", () => Constants.Regions.BRAZIL)
    .with("EU_EAST", () => Constants.Regions.EU_EAST)
    .with("EU_WEST", () => Constants.Regions.EU_WEST)
    .with("KOREA", () => Constants.Regions.KOREA)
    .with("LAT_NORTH", () => Constants.Regions.LAT_NORTH)
    .with("LAT_SOUTH", () => Constants.Regions.LAT_SOUTH)
    .with("AMERICA_NORTH", () => Constants.Regions.AMERICA_NORTH)
    .with("OCEANIA", () => Constants.Regions.OCEANIA)
    .with("TURKEY", () => Constants.Regions.TURKEY)
    .with("RUSSIA", () => Constants.Regions.RUSSIA)
    .with("JAPAN", () => Constants.Regions.JAPAN)
    .with("VIETNAM", () => Constants.Regions.VIETNAM)
    .with("TAIWAN", () => Constants.Regions.TAIWAN)
    .with("SINGAPORE", () => Constants.Regions.SINGAPORE)
    .with("PBE", () => Constants.Regions.PBE)
    .exhaustive();
}
