import { decompress } from "/fzstd.mjs";
import createEmulator from "/rift-combat-audio-emulator.mjs";
import profile from "/rift-combat-audio-profile.json";
import { openReplay } from "../../transport.mjs";
import { createNativeRiftEffectCreateReader } from "./native-rift-effect-create-reader.mjs";
import { createPreparedTerrainByteCodecs } from "./native-terrain-byte-codecs.mjs";
import { collectRecordedRiftCombatEffects } from "./recorded-rift-combat-effects.mjs";
import {
  createRecordedRiftStopReader,
  readRecordedRiftEffectPackets,
} from "./recorded-rift-effect-packets.mjs";

self.onmessage = async ({
  data: { replay, pages, stopMaps, visualResourceKeys },
}) => {
  try {
    const original = openReplay(replay);
    const packets = readRecordedRiftEffectPackets(original, decompress);
    const decodeStop =
      stopMaps === undefined
        ? undefined
        : createRecordedRiftStopReader(
            original,
            await createPreparedTerrainByteCodecs(
              new Uint8Array(stopMaps),
              original,
              { allowCurrentBuild: true },
            ),
          );
    const reader = await createNativeRiftEffectCreateReader(
      await createEmulator(),
      profile,
      new Uint8Array(pages),
      decodeStop === undefined ? undefined : visualResourceKeys,
    );
    try {
      const entries = collectRecordedRiftCombatEffects(
        packets,
        reader,
        decodeStop,
        visualResourceKeys,
      );
      self.postMessage({ ok: true, entries });
    } finally {
      reader.close();
    }
  } catch (error) {
    self.postMessage({ ok: false, message: error.message });
  }
};
