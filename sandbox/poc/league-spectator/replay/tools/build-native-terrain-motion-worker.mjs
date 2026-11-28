import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function buildMotionWorker(decompressorPath) {
  const vendor = await readFile(decompressorPath);
  assert.equal(
    sha256(vendor),
    "1a901fc5a58c349bbdb4f2aa1e688637ef56891ec58243a9f0cd863166b0d2a4",
    "Unexpected terrain worker decompressor",
  );
  const result = await Bun.build({
    entrypoints: [
      fileURLToPath(
        new URL("./research/native-terrain-motion-worker.mjs", import.meta.url),
      ),
    ],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: "pinned-terrain-decompressor",
        setup(builder) {
          builder.onResolve({ filter: /^scout-terrain-fzstd$/ }, () => ({
            path: "fzstd.mjs",
            namespace: "terrain-decompressor",
          }));
          builder.onLoad(
            { filter: /^fzstd\.mjs$/, namespace: "terrain-decompressor" },
            () => ({ contents: vendor.toString("utf8"), loader: "js" }),
          );
        },
      },
    ],
  });
  if (!result.success || result.outputs.length !== 1)
    throw new AggregateError(
      result.logs,
      "Browser replay worker bundle failed",
    );
  return result.outputs[0];
}

if (import.meta.main) {
  const [decompressor, output, ...extra] = Bun.argv.slice(2);
  assert.ok(
    output && extra.length === 0,
    "Usage: bun build-native-terrain-motion-worker.mjs <pinned fzstd.mjs> <new private worker file>",
  );
  const destination = resolve(output);
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(destination));
  assert.ok(parent === cache || parent.startsWith(cache + sep));
  const worker = Buffer.from(
    await (await buildMotionWorker(decompressor)).arrayBuffer(),
  );
  await writeFile(destination, worker, { flag: "wx" });
  console.log(sha256(worker));
}
