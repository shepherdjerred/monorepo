import { decompress } from "/fzstd.mjs";
import createEmulator from "/rift-startup-emulator.mjs";
import profile from "/rift-startup-profile.json";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { createStartupReader } from "./native-rift-startup-reader.mjs";

self.onmessage = async ({ data: { replay, pages } }) => {
  try {
    const original = openReplay(replay);
    if (
      original.build !== "16.23.841.8428" ||
      original.protocol !== "8bbfcd5af2bc92db"
    )
      throw Error("The original startup build is unsupported.");
    let body;
    for (const packet of replayPacketEnvelopes(original, decompress, {
      stream: 3,
    })) {
      if (packet.explicitOpcode !== 1022) continue;
      if (
        body !== undefined ||
        packet.chunkId !== 1 ||
        packet.blockOffset !== 0 ||
        packet.paramBits !== 0 ||
        packet.firstTimeBits !== 0 ||
        packet.secondTimeBits !== 0
      )
        throw Error("Unexpected original replay startup packet.");
      body = packet.payload;
    }
    if (body === undefined)
      throw Error("Missing original replay startup packet.");
    const read = await createStartupReader(
      await createEmulator(),
      profile,
      new Uint8Array(pages),
    );
    const result = read(body);
    if (result.configuredMapId !== 11 || result.mode !== "CLASSIC")
      throw Error(
        "The original replay startup does not identify Map11 CLASSIC.",
      );
    self.postMessage({ ok: true });
  } catch (error) {
    self.postMessage({ ok: false, message: error.message });
  }
};
