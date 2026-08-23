import {
  type Region,
  type PlatformRoute,
  regionToPlatformRoute,
} from "@scout-for-lol/data";

/**
 * Map a domain Region enum to its platform routing value (e.g. AMERICA_NORTH -> NA1).
 */
export function mapRegionToEnum(region: Region): PlatformRoute {
  return regionToPlatformRoute(region);
}
