import { sha256 } from "./structural-comparison.mjs";
import { CHAMPION_STATE_SHA } from "./latest-champion-state.mjs";
import { decodeRegisteredState } from "./latest-state-fields.mjs";
export const EXPERIENCE_SHA =
  "4feb3b66b0c250dbaa9b09a02a70cff9c45405b4f547d0ca49c3f0186340ee7f";

export async function createLatestExperienceReader(
  profile,
  image,
  bytes,
  championBytes,
) {
  if (
    (await sha256(bytes)) !== EXPERIENCE_SHA ||
    (await sha256(championBytes)) !== CHAMPION_STATE_SHA
  )
    throw Error("Pinned experience and champion schemas required");
  const parse = (b) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)),
    meta = parse(bytes),
    champion = parse(championBytes);
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-champion-experience" ||
    meta.build !== "16.21.829.8620" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    meta.championStatePackageSha256 !== CHAMPION_STATE_SHA ||
    Object.keys(meta.fields).join() !== "experience" ||
    meta.scope.experienceProgressGaugeAdmitted !== false
  )
    throw Error("Unsupported experience package");
  for (const b of meta.sourceBlocks)
    if ((await sha256(image.subarray(b.startRva, b.endRva))) !== b.sha256)
      throw Error("Original experience instructions changed");
  const binding = meta.fields.experience,
    group = champion.groups[binding.group];
  if (
    group.offsets[binding.index] !== binding.offset ||
    !((group.floatMask >>> binding.index) & 1)
  )
    throw Error("Experience registration differs from champion schema");
  return {
    metadata: structuredClone(meta),
    experience(record) {
      return decodeRegisteredState(record, {
        groups: champion.groups,
        fields: meta.fields,
      });
    },
  };
}
