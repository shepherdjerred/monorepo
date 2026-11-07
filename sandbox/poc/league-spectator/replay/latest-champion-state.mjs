import { sha256 } from "./structural-comparison.mjs";
import { decodeRegisteredState } from "./latest-state-fields.mjs";
import {
  createLatestReplicationReader,
  LATEST_REPLICATION_SHA,
} from "./latest-replication.mjs";
export const CHAMPION_STATE_SHA =
  "5a0e5c514cb9cb4818bfeb2ae3e7a7fa68306793b4f2709130006a0b1a545ba3";
export const CHAMPION_STATE_FIELDS = [
  "currentHealth",
  "maxHealth",
  "resourceValue",
  "resourceMax",
  "level",
  "currentGold",
];

export async function createLatestChampionStateReader(
  profile,
  image,
  replicationBytes,
  bytes,
) {
  if ((await sha256(bytes)) !== CHAMPION_STATE_SHA)
    throw Error("Pinned champion state schema required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-champion-state-schema" ||
    meta.build !== profile.clientVersion ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== profile.protocolDigest ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.replicationPackageSha256 !== LATEST_REPLICATION_SHA ||
    meta.registrationRva !== 0x13e690 ||
    meta.entityVtableRva !== 0x22f80e0 ||
    meta.optionalObserverConfig !== false ||
    Object.keys(meta.fields).length !== CHAMPION_STATE_FIELDS.length ||
    !CHAMPION_STATE_FIELDS.every((name) => Object.hasOwn(meta.fields, name))
  )
    throw Error("Unsupported champion state schema");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original champion state instructions changed");
  const reader = await createLatestReplicationReader(
    profile,
    image,
    replicationBytes,
  );
  return {
    metadata: structuredClone(meta),
    read: reader.read,
    championHealth: reader.championHealth,
    // The caller admits champion classes from recorded creation identities.
    championState(record) {
      return decodeRegisteredState(record, meta);
    },
  };
}

export function primaryResourcePresentation(catalog, recordPaths, defaults) {
  if (
    catalog.schema !== 2 ||
    !Array.isArray(recordPaths) ||
    !recordPaths.length
  )
    throw Error("Prepared champion resource catalog required");
  const configs = recordPaths.map((path) => {
    const source = catalog.records[path]?.data?.primaryAbilityResource;
    if (source?.__type !== "AbilityResourceSlotInfo")
      throw Error("Missing primary resource definition");
    const result = { ...defaults };
    for (const key of Object.keys(result))
      if (Object.hasOwn(source, key)) result[key] = source[key];
    if (
      !Number.isInteger(result.arType) ||
      result.arType < 0 ||
      result.arType > 255 ||
      typeof result.arIsShown !== "boolean" ||
      typeof result.arDisplayAsPips !== "boolean" ||
      !Number.isInteger(result.arMaxSegments) ||
      result.arMaxSegments < 0 ||
      !Number.isInteger(result.arIncrements) ||
      result.arIncrements < 0
    )
      throw Error("Unsupported primary resource presentation");
    return result;
  });
  if (configs.some((c) => JSON.stringify(c) !== JSON.stringify(configs[0])))
    throw Error("Active form required for differing resource definitions");
  return configs[0];
}
