import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createNativeRiftEffectCreateReader,
  hasSennaGroundHitResourceKey,
  sennaGroundHitResourceKey,
} from "./native-rift-effect-create-reader.mjs";

const [directory, emulator, ...inputs] = process.argv.slice(2);
const sennaGroundHitOnly = inputs.includes("--senna-ground-hit-only");
const corpora = inputs.filter((input) => input !== "--senna-ground-hit-only");
if (!directory || !emulator || !corpora.length)
  throw Error(
    "Usage: verify-rift-effect-create-pages.mjs <capture-directory> <emulator> <corpus> [...corpora] [--senna-ground-hit-only]",
  );

const [profile, pages, expected] = await Promise.all([
  Bun.file(join(directory, "profile.json")).json(),
  Bun.file(join(directory, "pages.bin")).bytes(),
  Bun.file(join(directory, "witnesses.json")).json(),
]);
const { default: factory } = await import(
  pathToFileURL(resolve(emulator)).href
);
const uc = await factory();
const reader = await createNativeRiftEffectCreateReader(uc, profile, pages);
const word = new DataView(new ArrayBuffer(4));
const floatBits = (value) => {
  word.setFloat32(0, value, true);
  return word.getUint32(0, true);
};

try {
  let control;
  for (const corpus of corpora) {
    const { replaySha256, packets } = await Bun.file(corpus).json();
    const digest = new Bun.CryptoHasher("sha256");
    const witness = {
      replaySha256,
      packets: 0,
      groups: 0,
      entries: 0,
      candidates: 0,
    };
    const started = performance.now();
    for (const [, sequence, context, body] of packets) {
      const payload = new Uint8Array(Buffer.from(body, "hex"));
      const candidate = hasSennaGroundHitResourceKey(payload);
      if (sennaGroundHitOnly && !candidate) continue;
      witness.packets++;
      const groups = reader
        .decode(payload, context)
        .map(({ resourceKey, entries }) => {
          witness.groups++;
          witness.entries += entries.length;
          if (resourceKey === sennaGroundHitResourceKey) {
            assert.equal(candidate, true);
            control ??= { payload, context };
          }
          return [
            resourceKey,
            entries.map(({ handle, owner, parent, descriptor }) => {
              if (descriptor === null) return [handle, owner, parent, null];
              witness.candidates++;
              const { flags, positions, scaleRate } = descriptor;
              return [
                handle,
                owner,
                parent,
                [
                  flags,
                  ...positions.flat().map(floatBits),
                  ...scaleRate.map(floatBits),
                ],
              ];
            }),
          ];
        });
      digest.update(JSON.stringify([sequence, groups]) + "\n");
    }
    witness.identitySha256 = digest.digest("hex");
    assert.deepEqual(
      witness,
      expected.find((row) => row.replaySha256 === replaySha256),
    );
    console.log(
      JSON.stringify({
        ...witness,
        sourcePackets: packets.length,
        milliseconds: Math.round(performance.now() - started),
      }),
    );
  }
  assert.ok(
    control,
    "Expected a native candidate for truncation and trailing-byte controls",
  );
  const { payload, context } = control;
  const expectedPacket = reader.decode(payload, context);
  assert.throws(
    () => reader.decode(payload.subarray(0, -1), context),
    /consume the entire body/u,
  );
  assert.throws(
    () => reader.decode(Uint8Array.from([...payload, 0]), context),
    /consume the entire body/u,
  );
  assert.deepEqual(reader.decode(payload, context), expectedPacket);
} finally {
  reader.close();
}
