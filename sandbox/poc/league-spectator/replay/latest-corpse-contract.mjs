import {
  MAP11_BASE_WORLD_CATALOG_SHA,
  MAP11_NEUTRAL_WORLD_CATALOG_SHA,
  MAP11_NEUTRAL_CORPSE_POLICY_SHA,
  MAP11_ORDINAL_WORLD_CATALOG_SHA,
  MAP11_ORDINAL_CORPSE_POLICY_SHA,
  MAP11_CORPUS_WORLD_CATALOG_SHA,
  MAP11_CORPUS_CORPSE_POLICY_SHA,
} from "./latest-map11-neutral-contract.mjs";
export { MAP11_NEUTRAL_CORPSE_POLICY_SHA } from "./latest-map11-neutral-contract.mjs";
export { MAP11_ORDINAL_CORPSE_POLICY_SHA } from "./latest-map11-neutral-contract.mjs";
export { MAP11_CORPUS_CORPSE_POLICY_SHA } from "./latest-map11-neutral-contract.mjs";
export const CORPSE_POLICY_SHA =
  "c39f81b4c3f06bba440637121aa5863e73ec82f42f38b1a8a10f4d070d99768d";
// Original constructor/getter/death/clock/retirement controls re-executed for
// the eight archived Summoner's Rift minion CharacterRecords.
export const MAP11_CORPSE_POLICY_SHA =
  "4989c2a9d30d806eea05f98c43555b66c5b77d536cc9c0dc22a57db7f6ea4834";
export function approvedCorpsePolicyReferenceSha(
  mapId,
  worldCatalogSha256 = null,
) {
  if (mapId === 12) return CORPSE_POLICY_SHA;
  if (mapId === 11 && worldCatalogSha256 === MAP11_CORPUS_WORLD_CATALOG_SHA)
    return MAP11_CORPUS_CORPSE_POLICY_SHA;
  if (mapId === 11 && worldCatalogSha256 === MAP11_ORDINAL_WORLD_CATALOG_SHA)
    return MAP11_ORDINAL_CORPSE_POLICY_SHA;
  if (mapId === 11 && worldCatalogSha256 === MAP11_NEUTRAL_WORLD_CATALOG_SHA)
    return MAP11_NEUTRAL_CORPSE_POLICY_SHA;
  if (
    mapId === 11 &&
    worldCatalogSha256 !== null &&
    worldCatalogSha256 !== MAP11_BASE_WORLD_CATALOG_SHA
  )
    throw Error("No independently approved Map11 corpse asset catalog");
  if (mapId === 11) return MAP11_CORPSE_POLICY_SHA;
  throw Error("No independently approved corpse policy for selected map");
}
