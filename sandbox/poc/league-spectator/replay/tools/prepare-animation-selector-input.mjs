import path from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [sourcePath, expectedSha, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun prepare-animation-selector-input.mjs <original-graph.bin> <sha256> <output.json>",
  );
const raw = await Bun.file(sourcePath).bytes();
if ((await sha256(raw)) !== expectedSha)
  throw Error("Original graph source digest changed");
const tree = readExactMapBin(raw, "16.21.829.8620", {
    captureFieldSpans: true,
  }),
  roots = tree.objects.filter((node) => node.classHash === "f5fb07c7");
if (roots.length !== 1)
  throw Error("One original animation graph owner required");
const root = roots[0],
  fields = [];
for (const span of root.fieldSpans)
  fields.push({
    ...span,
    sha256: await sha256(raw.subarray(span.offset, span.offset + span.bytes)),
  });
const request = {
  schema: 1,
  kind: "original-animation-selector-input",
  build: tree.build,
  protocol: "20e09df23c66b85e",
  source: {
    file: path.resolve(sourcePath),
    sha256: expectedSha,
    bytes: raw.length,
  },
  ownerPath: root.pathHash,
  fields,
  readerSha256: await sha256(
    await Bun.file(new URL("exact-map-bin.mjs", import.meta.url)).bytes(),
  ),
  preparerSha256: await sha256(await Bun.file(import.meta.path).bytes()),
};
await Bun.write(output, JSON.stringify(request, null, 2));
console.log(
  JSON.stringify({ output, source: request.source, fields: fields.length }),
);
