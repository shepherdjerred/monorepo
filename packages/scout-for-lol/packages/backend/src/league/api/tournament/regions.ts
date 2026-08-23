import { match } from "ts-pattern";
import type { Region, TournamentRegion } from "@scout-for-lol/data/index.ts";
import { mapRegionToEnum } from "#src/league/model/region.ts";

/**
 * Scout's `Region` to the tournament API's own region code.
 *
 * These are a third naming scheme, distinct from both the platform ids
 * (`NA1`, `EUW1`) and the routing values (`americas`). Exhaustive by
 * construction, so a new Scout region is a compile error here rather than a
 * runtime surprise at lobby-creation time.
 */
export function toTournamentRegion(region: Region): TournamentRegion {
  return match(region)
    .returnType<TournamentRegion>()
    .with("BRAZIL", () => "BR")
    .with("EU_EAST", () => "EUNE")
    .with("EU_WEST", () => "EUW")
    .with("JAPAN", () => "JP")
    .with("KOREA", () => "KR")
    .with("LAT_NORTH", () => "LAN")
    .with("LAT_SOUTH", () => "LAS")
    .with("AMERICA_NORTH", () => "NA")
    .with("OCEANIA", () => "OCE")
    .with("PBE", () => "PBE")
    .with("RUSSIA", () => "RU")
    .with("TURKEY", () => "TR")
    .with("SINGAPORE", () => "SG")
    .with("TAIWAN", () => "TW")
    .with("VIETNAM", () => "VN")
    .exhaustive();
}

/**
 * The platform id a match on this region is keyed by, e.g. `"NA1"`.
 *
 * `games/by-code` answers with a bare numeric `gameId`; Match-V5 wants
 * `{PLATFORM}_{gameId}`, so this supplies the missing half.
 */
export function toPlatformId(region: Region): string {
  return mapRegionToEnum(region).toUpperCase();
}
