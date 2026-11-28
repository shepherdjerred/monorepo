import { decompress } from "/fzstd.mjs";
import createEmulator from "/rift-projectile-emulator.mjs";
import profile from "/rift-projectile-profile.json";
import { openReplay } from "../../transport.mjs";
import { createNativeRiftMissileLaunchReader } from "./native-rift-missile-launch-reader.mjs";
import { assertRecordedRiftEffectBuild } from "./recorded-rift-effect-packets.mjs";
import { collectRiftProjectileVisiblePrefixes } from "./recorded-rift-projectile-prefixes.mjs";

self.onmessage = async ({
  data: { replay, pages, verifiedOwners, shardIndex = 0, shardCount = 1 },
}) => {
  try {
    const original = openReplay(replay);
    assertRecordedRiftEffectBuild(original);
    if (
      !Array.isArray(verifiedOwners) ||
      !verifiedOwners.every((owner) => owner >>> 0 === owner && owner !== 0)
    )
      throw Error("Invalid verified projectile owners");
    if (
      !Number.isInteger(shardCount) ||
      shardCount < 1 ||
      shardCount > 4 ||
      !Number.isInteger(shardIndex) ||
      shardIndex < 0 ||
      shardIndex >= shardCount
    )
      throw Error("Invalid projectile decode shard");
    const owners = new Set(verifiedOwners);
    if (owners.size === 0) {
      self.postMessage({ ok: true, prefixes: [] });
      return;
    }
    const reader = await createNativeRiftMissileLaunchReader(
      await createEmulator(),
      profile,
      new Uint8Array(pages),
    );
    try {
      let launchOrdinal = 0;
      const prefixes = collectRiftProjectileVisiblePrefixes(
        original,
        decompress,
        (payload, context) =>
          launchOrdinal++ % shardCount === shardIndex
            ? reader.decode(payload, context)
            : null,
        owners,
      );
      self.postMessage({ ok: true, prefixes });
    } finally {
      reader.close();
    }
  } catch (error) {
    self.postMessage({ ok: false, message: error.message });
  }
};
