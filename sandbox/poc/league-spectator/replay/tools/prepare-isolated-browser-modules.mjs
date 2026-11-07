// Repair only the declared same-build browser module closure in an isolated
// cache. This does not regenerate scene, profile, material, or catalog data.
import { resolve, dirname, relative } from "node:path";
import { mkdir, lstat } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg || process.argv.length !== 4)
  throw Error(
    "Usage: prepare-isolated-browser-modules.mjs <approved-cache> <isolated-cache>",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg);
if (
  source === target ||
  relative(source, target).split(/[\\/]/)[0] !== ".." ||
  /[\\/]hs(?:[\\/]|$)/i.test(target)
)
  throw Error("A separate non-hs cache is required");
const inputs = {},
  outputs = {};
async function raw(path) {
  if (!(await lstat(path)).isFile())
    throw Error("Ordinary static module file required: " + path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
await raw(import.meta.path);
const profiles = [];
for (const cache of [source, target])
  profiles.push(
    JSON.parse(
      new TextDecoder().decode(
        await raw(`${cache}/public/decoder-16.21-macos/profile.json`),
      ),
    ),
  );
if (
  profiles.some(
    (p) =>
      p.clientVersion !== "16.21.829.8620" ||
      p.protocolDigest !== "20e09df23c66b85e",
  ) ||
  profiles[0].decoderImageSha256 !== profiles[1].decoderImageSha256
)
  throw Error("Matching approved build profiles required");
for (const name of ["BufferGeometryUtils.js", "SkeletonUtils.js"]) {
  const path = `utils/${name}`,
    bytes = await raw(`${source}/public/${path}`),
    destination = `${target}/public/${path}`;
  if (await Bun.file(destination).exists()) {
    if ((await sha256(await raw(destination))) !== (await sha256(bytes)))
      throw Error(
        "Cannot replace a different isolated browser module: " + path,
      );
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, bytes);
  }
  const digest = await sha256(await raw(destination));
  if (digest !== (await sha256(bytes)))
    throw Error("Browser module copy readback differs");
  outputs[path] = { sha256: digest, bytes: bytes.length };
}
const output = `${target}/research/isolated-browser-module-preparation.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "isolated-browser-module-closure-repair",
      inputs,
      outputs,
      scope: {
        exactBytesReadBack: true,
        primaryMutated: false,
        catalogMutated: false,
        runtimeCoverageEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, outputs }));
