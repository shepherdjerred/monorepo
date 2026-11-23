// Fixed native minion/turret schema proof, independent of scene selection.
import {
  MAP11_BASE_WORLD_CATALOG_SHA,
  MAP11_NEUTRAL_WORLD_CATALOG_SHA,
  MAP11_NEUTRAL_WORLD_STATE_SHA,
  MAP11_ORDINAL_WORLD_CATALOG_SHA,
  MAP11_ORDINAL_WORLD_STATE_SHA,
  MAP11_CORPUS_WORLD_CATALOG_SHA,
  MAP11_CORPUS_WORLD_STATE_SHA,
} from "./latest-map11-neutral-contract.mjs";
export { MAP11_NEUTRAL_WORLD_STATE_SHA } from "./latest-map11-neutral-contract.mjs";
export { MAP11_ORDINAL_WORLD_STATE_SHA } from "./latest-map11-neutral-contract.mjs";
export { MAP11_CORPUS_WORLD_STATE_SHA } from "./latest-map11-neutral-contract.mjs";
export const WORLD_STATE_SHA =
  "3391cfd4ba92d407f97f2214ff51064e029f53966a884a9926d5630c2bb25b90";
// Independently generated from the exact archived Map11 world/minion catalog.
// Original class schemas/defaults/instructions equal the Map12 build program;
// map, catalog and authored asset bindings are separately fixed here.
export const MAP11_WORLD_STATE_SHA =
  "8c87ff65515392c77743b579e5c9647e072d39a9948fb38a23b84d45d971d922";
export function approvedWorldStateReferenceSha(
  mapId,
  worldCatalogSha256 = null,
) {
  if (mapId === 12) return WORLD_STATE_SHA;
  if (mapId === 11 && worldCatalogSha256 === MAP11_CORPUS_WORLD_CATALOG_SHA)
    return MAP11_CORPUS_WORLD_STATE_SHA;
  if (mapId === 11 && worldCatalogSha256 === MAP11_ORDINAL_WORLD_CATALOG_SHA)
    return MAP11_ORDINAL_WORLD_STATE_SHA;
  if (mapId === 11 && worldCatalogSha256 === MAP11_NEUTRAL_WORLD_CATALOG_SHA)
    return MAP11_NEUTRAL_WORLD_STATE_SHA;
  if (
    mapId === 11 &&
    worldCatalogSha256 !== null &&
    worldCatalogSha256 !== MAP11_BASE_WORLD_CATALOG_SHA
  )
    throw Error("No independently approved Map11 world asset catalog");
  if (mapId === 11) return MAP11_WORLD_STATE_SHA;
  throw Error("No independently approved world schema for selected map");
}
