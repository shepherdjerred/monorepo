// Public primary enum reference, pinned independently of the League executable.
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const [folderArg] = process.argv.slice(2);
if (!folderArg)
  throw Error("Usage: bun fetch-sampler-reference.mjs <research-folder>");
const folder = resolve(folderArg),
  revision = "8cdde68ae36a636c84cbb48ebcbc8f3b60251ea0";
const url = `https://raw.githubusercontent.com/apple/metal-cpp/${revision}/Metal/MTLSampler.hpp`;
const response = await fetch(url);
if (!response.ok)
  throw Error(`Apple sampler reference HTTP ${response.status}`);
const bytes = await response.arrayBuffer();
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  sha256 !== "7876a1f3070a03eecda730181d6868fe8479bf2d7a5f3a262e1ceedb72f3da14"
)
  throw Error("Apple sampler reference changed");
await mkdir(folder, { recursive: true });
await Bun.write(`${folder}/MTLSampler.hpp`, bytes);
await Bun.write(
  `${folder}/metal-sampler-primary.json`,
  `${JSON.stringify({ revision, url, sha256 }, null, 2)}\n`,
);
console.log(JSON.stringify({ revision, sha256 }));
