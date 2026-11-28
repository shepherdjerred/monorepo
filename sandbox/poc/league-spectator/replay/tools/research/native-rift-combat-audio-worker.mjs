import { decompress } from "/fzstd.mjs";
import createEmulator from "/rift-combat-audio-emulator.mjs";
import profile from "/rift-combat-audio-profile.json";
import { openReplay } from "../../transport.mjs";
import {
  createNativeRiftEffectCreateReader,
  hasSennaGroundHitResourceKey,
  sennaGroundHitResourceKey,
} from "./native-rift-effect-create-reader.mjs";
import { readRecordedRiftEffectPackets } from "./recorded-rift-effect-packets.mjs";

self.onmessage = async ({ data: { replay, pages } }) => {
  try {
    const packets = readRecordedRiftEffectPackets(
      openReplay(replay),
      decompress,
    );
    const reader = await createNativeRiftEffectCreateReader(
      await createEmulator(),
      profile,
      new Uint8Array(pages),
    );
    try {
      const entries = [];
      for (const { kind, context, timeSeconds, payload } of packets) {
        if (kind !== "create" || !hasSennaGroundHitResourceKey(payload))
          continue;
        for (const group of reader.decode(payload, context)) {
          const { resourceKey } = group;
          if (resourceKey !== sennaGroundHitResourceKey) continue;
          for (const { owner, parent, handle, descriptor } of group.entries) {
            if (descriptor === null) continue;
            entries.push({
              timeSeconds,
              context,
              resourceKey,
              owner,
              parent,
              handle,
              ...descriptor,
            });
          }
        }
      }
      self.postMessage({ ok: true, entries });
    } finally {
      reader.close();
    }
  } catch (error) {
    self.postMessage({ ok: false, message: error.message });
  }
};
