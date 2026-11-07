import { decompress } from "/assets/vendor/fzstd.mjs";
import { parseReplay, FIXTURE_SHA256 } from "./decoder.mjs";
import createUnicorn from "/assets/vendor/unicorn_x86.mjs";
import { NativeDecoder } from "./native-decoder.mjs";
import { decodeGameplay } from "./gameplay-decoder.mjs";
const digestHex = async (data) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
async function asset(path) {
  const response = await fetch(path);
  if (!response.ok) throw Error(`Decoder package unavailable: ${path}`);
  return response;
}
self.onmessage = async ({ data }) => {
  try {
    const started = performance.now();
    if (data.buffer.byteLength > 512 * 1024 * 1024)
      throw new Error("Replay exceeds 512 MiB limit");
    const hash = await crypto.subtle.digest("SHA-256", data.buffer);
    const sha256 = Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    if (sha256 !== FIXTURE_SHA256)
      throw new Error(
        "Unsupported fixture. This spike accepts only KR_8305643709.rofl from build 16.14.794.5912; other builds and matches require their own validated decoder and identity package.",
      );
    const result = parseReplay(
      data.buffer,
      decompress,
      (progress) => self.postMessage({ type: "progress", progress }),
      { collectGameplay: true },
    );
    self.postMessage({
      type: "progress",
      progress: { message: "Loading exact-build gameplay decoder…" },
    });
    const [profile, image, uc, extra] = await Promise.all([
      asset("/assets/decoder/profile.json").then((r) => r.json()),
      asset("/assets/decoder/image.bin").then((r) => r.arrayBuffer()),
      createUnicorn(),
      asset("/gameplay-profile.json").then((r) => r.json()),
    ]);
    if (
      profile.clientVersion !== result.build ||
      profile.protocolDigest !== result.protocol ||
      profile.clientSha256 !==
        "34de26710352fcf4360b27691cecf77843a0ea338cd455be4fabb63fb467984f"
    )
      throw Error("Gameplay decoder build mismatch");
    if ((await digestHex(image)) !== profile.decoderImageSha256)
      throw Error("Gameplay decoder image hash mismatch");
    Object.assign(profile.decoders, extra);
    const engine = new NativeDecoder(uc, profile, new Uint8Array(image));
    result.gameplay = [];
    try {
      for (let i = 0; i < result.gameplayPackets.length; i++) {
        result.gameplay.push(decodeGameplay(engine, result.gameplayPackets[i]));
        if (i % 500 === 0)
          self.postMessage({
            type: "progress",
            progress: {
              message: `Decoding gameplay ${i.toLocaleString()} / ${result.gameplayPackets.length.toLocaleString()}…`,
            },
          });
      }
    } finally {
      engine.close();
    }
    result.gameplay.sort((a, b) => a.time - b.time);
    delete result.gameplayPackets;
    let length = 0;
    for (const p of result.movementPayloads) length += 4 + p.length;
    const packed = new Uint8Array(length),
      view = new DataView(packed.buffer);
    let offset = 0;
    for (const p of result.movementPayloads) {
      view.setUint32(offset, p.length, true);
      packed.set(p, offset + 4);
      offset += 4 + p.length;
    }
    const digest = await crypto.subtle.digest("SHA-256", packed);
    result.movementDigest = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    delete result.movementPayloads;
    self.postMessage({
      type: "ready",
      result: { ...result, sha256, decodeMs: performance.now() - started },
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
