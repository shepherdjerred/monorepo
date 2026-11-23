import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { captureResearchSourceClosure } from "./research-source-closure.mjs";

const [replay, packages, runtime, vendor, prefix, end, mapCache] =
  process.argv.slice(2);
if (!mapCache)
  throw Error(
    "Usage: inspect-byte-io-reconstruction.mjs <replay> <packages> <runtime> <fzstd> <output-prefix> <end> <exact-map-cache>",
  );
const cliUrl = new URL("./inspect-latest-semantics.mjs", import.meta.url);
const wrapUrl = new URL("./wrap-unicorn-byte-io.mjs", import.meta.url);
const roots = [new URL(import.meta.url), cliUrl, wrapUrl];
const before = await captureResearchSourceClosure(roots);
let source = await Bun.file(cliUrl).text();
source = source.replace(
  /from "(\.{1,2}\/[^\"]+)"/g,
  (_, file) => `from ${JSON.stringify(new URL(file, cliUrl).href)}`,
);
const seam = "uc: await createUnicorn(),";
if (source.split(seam).length !== 2)
  throw Error("Exact original decoder runtime input seam required");
const baseline = source;
const candidate =
  `import { wrapUnicornByteIo } from ${JSON.stringify(wrapUrl.href)};\n` +
  source.replace(seam, "uc: wrapUnicornByteIo(await createUnicorn()),");
const originalArgs = process.argv;
const runs = [];
try {
  for (const [name, script] of [
    ["original", baseline],
    ["word-packed", candidate],
  ]) {
    const reportPath = resolve(`${prefix}-${name}.json`);
    process.argv = [
      process.execPath,
      cliUrl.pathname,
      replay,
      packages,
      runtime,
      vendor,
      reportPath,
      end,
      mapCache,
    ];
    const started = performance.now();
    await import(
      `data:text/javascript;base64,${Buffer.from(script).toString("base64")}`
    );
    runs.push({
      name,
      reportPath,
      elapsedMs: performance.now() - started,
      sha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(reportPath).bytes())
        .digest("hex"),
    });
  }
} finally {
  process.argv = originalArgs;
}
if (runs[0].sha256 !== runs[1].sha256)
  throw Error("Host byte IO changed an original semantic report byte");
const after = await captureResearchSourceClosure(roots);
if (!isDeepStrictEqual(before, after))
  throw Error("Byte IO reconstruction sources changed during comparison");
const proof = {
  scope:
    "Complete original reconstruction outputs under original versus word-packed host memory API; no browser integration or performance acceptance claim",
  runs,
  identicalReportBytes: true,
  sourceBefore: before,
  sourceAfter: after,
};
await Bun.write(`${prefix}-comparison.json`, JSON.stringify(proof, null, 2));
console.log(
  JSON.stringify({
    output: `${prefix}-comparison.json`,
    runs,
    identicalReportBytes: true,
  }),
);
