import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { verifyParticleColorProofInputs } from "./particle-color-bindings.mjs";

const assets = resolve(import.meta.dir, "..");
const recovery = {
  recordedAssetRoot: "C:\\archive\\recorded\\public",
  sourceRoot: import.meta.dir,
};
const raw = (path) => Bun.file(path).bytes();
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const recordedInput = "C:\\archive\\recorded\\public\\latest-vfx-materials.mjs";

test("verifies native source and asset bytes at explicit recovery roots", async () => {
  const inputBytes = await raw(resolve(assets, "latest-vfx-materials.mjs"));
  const sourceBytes = await raw(resolve(import.meta.dir, "macho.py"));
  const input = {
    assets,
    recovery,
    raw,
    sha,
    inputs: { [recordedInput]: sha(inputBytes) },
    sources: { "macho.py": sha(sourceBytes) },
  };
  await expect(verifyParticleColorProofInputs(input)).resolves.toBeUndefined();
  await expect(
    verifyParticleColorProofInputs({
      ...input,
      inputs: { [recordedInput]: sha(sourceBytes) },
    }),
  ).rejects.toThrow("Native particle color input changed");
  await expect(
    verifyParticleColorProofInputs({
      ...input,
      sources: { "macho.py": sha(inputBytes) },
    }),
  ).rejects.toThrow("Native particle color source changed");
});

test("rejects input paths outside the recorded root before reading", async () => {
  const verify = (path) =>
    verifyParticleColorProofInputs({
      assets,
      recovery,
      raw: () => {
        throw Error("Unexpected file read");
      },
      sha,
      inputs: { [path]: "unused" },
      sources: {},
    });
  await expect(
    verify("C:\\archive\\recorded\\public-extra\\image.bin"),
  ).rejects.toThrow("Unrecognized recorded particle color asset root");
  await expect(
    verify("C:\\archive\\recorded\\public\\..\\image.bin"),
  ).rejects.toThrow("Invalid recovered particle color asset path");
  await expect(
    verify("C:/archive/recorded/public/decoder/../image.bin"),
  ).rejects.toThrow("Invalid recovered particle color asset path");
});
