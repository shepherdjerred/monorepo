import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { sha256 } from "../structural-comparison.mjs";
import {
  adaptThreeUniformBindings,
  THREE_UPSTREAM_SHA256,
} from "./three-uniform-bindings.mjs";

export async function prepareThreeUniformBindings(cache) {
  cache = resolve(cache);
  const output = `${cache}/public/vendor/three.module.js`,
    upstreamPath = `${cache}/public/vendor/three.module.upstream.js`,
    upstreamFile = Bun.file(upstreamPath),
    existingFile = Bun.file(output);
  await mkdir(dirname(upstreamPath), { recursive: true });
  if (!(await upstreamFile.exists())) {
    const existing = await existingFile.bytes();
    if ((await sha256(existing)) !== THREE_UPSTREAM_SHA256)
      throw Error(
        "Exact original THREE bytes required to seed the independent upstream input",
      );
    await Bun.write(upstreamPath, existing);
  }
  const upstream = await Bun.file(upstreamPath).text(),
    adapted = await adaptThreeUniformBindings(upstream);
  // The independently pinned raw input owns this generated output. Rebuild
  // stale or corrupt derived bytes; never treat them as an upstream download.
  await Bun.write(output, adapted.source);
  const provenance = {
    schema: 1,
    policy: adapted.policy,
    upstream: {
      file: "vendor/three.module.upstream.js",
      sha256: adapted.upstreamSha256,
    },
    derived: { file: "vendor/three.module.js", sha256: adapted.adaptedSha256 },
    producerSha256: await sha256(
      await Bun.file(
        new URL("three-uniform-bindings.mjs", import.meta.url),
      ).bytes(),
    ),
    producerInputs: {
      "latest-renderer-samplers.mjs": await sha256(
        await Bun.file(
          new URL("../latest-renderer-samplers.mjs", import.meta.url),
        ).bytes(),
      ),
      "latest-renderer-policy.mjs": await sha256(
        await Bun.file(
          new URL("../latest-renderer-policy.mjs", import.meta.url),
        ).bytes(),
      ),
    },
  };
  await Bun.write(
    `${cache}/public/vendor/three-uniform-bindings.json`,
    JSON.stringify(provenance, null, 2),
  );
  return provenance;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(
    JSON.stringify(
      await prepareThreeUniformBindings(
        process.argv[2] ?? ".cache/replay-spike",
      ),
    ),
  );
