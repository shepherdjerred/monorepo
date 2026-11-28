import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { openLocalWad } from "../wad.mjs";

const [installation, compiler, outputDirectory] = process.argv.slice(2);
assert(
  installation && compiler && outputDirectory,
  "Usage: bun prepare-rift-navmesh-filter-shaders.mjs INSTALLATION SHADER_PREPARE NEW_OUTPUT_DIRECTORY",
);
const stages = [
  {
    name: "post",
    stage: "vertex",
    path: "gamma/post_effect.vs",
    sha256: "ea6fba36ce6d661beb55e8b2aa4856753a04bb6a8862b022387d7a027288b22a",
  },
  {
    name: "fade",
    stage: "pixel",
    path: "regions/fade.ps",
    sha256: "98a98b9fb3b0f8ac1e60d1d2c1d986f6e5f245bc4f6c2d8d1c3b2ff0462ab3e5",
  },
  {
    name: "blur",
    stage: "pixel",
    path: "regions/fastseparablegaussianblur.ps",
    sha256: "8d191c51e4cecea3adb01c254a8778c487fe835a483699a74456bd029efe18cc",
  },
];
const sha = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const wad = await openLocalWad(
  installation,
  "DATA/FINAL/ShaderCache.dx11.wad.client",
  zstdDecompressSync,
);
const entries = await Promise.all(
  stages.map(async ({ name, stage, path, sha256 }) => {
    const originalPath = `assets/shaders/hlsl/${path}-dx11_0`;
    const record = Buffer.from(await wad(originalPath));
    assert.equal(record.length, 4 + record.readUInt32LE(0));
    assert.equal(record.subarray(4, 8).toString(), "DXBC");
    const bytecode = record.subarray(4, 4 + record.readUInt32LE(28));
    assert.equal(
      sha(bytecode),
      sha256,
      `Unexpected authored shader ${originalPath}`,
    );
    return { name, stage, originalPath, bytecode, dxbcSha256: sha256 };
  }),
);

await mkdir(outputDirectory);
const jobs = await Promise.all(
  entries.map(async ({ name, stage, bytecode }) => {
    const source = resolve(outputDirectory, `${name}.dxbc`);
    await writeFile(source, bytecode, { flag: "wx" });
    return { stage, source, output: resolve(outputDirectory, `${name}.json`) };
  }),
);
const commands = resolve(outputDirectory, "commands.json");
await writeFile(commands, JSON.stringify(jobs), { flag: "wx" });
const translation = resolve(outputDirectory, "translation.json");
const result = Bun.spawnSync([compiler, "translate", commands, translation]);
assert.equal(result.exitCode, 0, result.stderr.toString());

const receipt = await Promise.all(
  entries.map(async ({ name, stage, originalPath, dxbcSha256 }, index) => {
    const { glsl } = await Bun.file(jobs[index].output).json();
    assert.ok(typeof glsl === "string" && glsl.length > 0);
    return { name, stage, originalPath, dxbcSha256, glslSha256: sha(glsl) };
  }),
);
await writeFile(
  resolve(outputDirectory, "nav-filter-shaders.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx" },
);
console.log("Matched and translated all three original navmesh filter stages.");
