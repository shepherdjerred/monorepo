// Isolated regression baseline: reverse only the seven observer additions in
// memory, then bundle the unchanged diagnostic CLI. No served file is written.
import assert from "node:assert/strict";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 3)
  throw Error("Usage: bun prepare-buff-observer-baseline.mjs <output-cache>");
const root = fileURLToPath(new URL("../", import.meta.url)),
  entry = join(root, "tools/inspect-latest-semantics.mjs"),
  target = join(root, "latest-reconstruction.mjs"),
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    digest = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === digest,
    "Observer baseline source changed",
  );
  inputs[path] = digest;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path, entry], raw);
const currentBytes = await raw(target),
  current = new TextDecoder("utf-8", { fatal: true }).decode(currentBytes),
  newline = current.includes("\r\n") ? "\r\n" : "\n",
  lines = (value) => value.replaceAll("\n", newline),
  changes = [];
let previous = current;
function replaceOnce(name, from, to = "") {
  from = lines(from);
  to = lines(to);
  const at = previous.indexOf(from);
  assert(
    at >= 0 && previous.indexOf(from, at + from.length) === -1,
    "Exactly one observer delta required: " + name,
  );
  changes.push({ name, removed: from, inserted: to });
  previous = previous.slice(0, at) + to + previous.slice(at + from.length);
}
function removeUntil(name, open, close) {
  open = lines(open);
  close = lines(close);
  const begin = previous.indexOf(open),
    end = previous.indexOf(close, begin + open.length);
  assert(
    begin >= 0 &&
      previous.indexOf(open, begin + open.length) === -1 &&
      end > begin,
    "Exactly one bounded observer block required: " + name,
  );
  replaceOnce(name, previous.slice(begin, end));
}
replaceOnce(
  "import",
  'import { createLatestBuffResourceArgumentReader } from "./latest-buff-resource-arguments.mjs";\n',
);
replaceOnce(
  "argument-arrays",
  "    buffResourceArguments = [],\n    buffResourceSnapshots = [],\n",
);
replaceOnce(
  "reader-owner",
  "    transportSequence = 0,\n    buffResourceArgumentReader = null;",
  "    transportSequence = 0;",
);
removeUntil(
  "reader-initialization",
  "    if (startup.configuredMapId === 11)\n      buffResourceArgumentReader",
  "    for (const chunk of replayChunks(replay, decompress))",
);
removeUntil(
  "packet-observer",
  "        if (\n          buffResourceArgumentReader !== null",
  "        if (\n          neutralCreationReader !== null",
);
replaceOnce("reader-disposal", "    buffResourceArgumentReader?.close();\n");
removeUntil(
  "report-inventory",
  "    ...(buffResourceArgumentReader === null\n",
  "    neutralCreationScope:",
);
assert.equal(changes.length, 7);
assert(
  !previous.includes("buffResourceArgument") &&
    !previous.includes("latest-buff-resource-arguments"),
);
const bundle = await Bun.build({
  entrypoints: [entry],
  target: "bun",
  format: "esm",
  minify: false,
  plugins: [
    {
      name: "previous-observer-source-only",
      setup(build) {
        build.onLoad({ filter: /latest-reconstruction\.mjs$/ }, (args) => {
          assert.equal(resolve(args.path), resolve(target));
          return {
            contents: previous,
            loader: "js",
            resolveDir: dirname(target),
          };
        });
      },
    },
  ],
});
assert(
  bundle.success && bundle.outputs.length === 1,
  "Previous-source diagnostic CLI bundle failed",
);
const bundled = new Uint8Array(await bundle.outputs[0].arrayBuffer());
for (const [file, expected] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), expected);
const output = await createStaticPreparationOutput(root, resolve(outputArg), {
  prefix: "buff-baseline-",
  directory: "baseline",
});
const cli = join(output.out, "inspect-previous-semantics.mjs");
await Bun.write(cli, bundled);
await Bun.write(join(output.out, "previous-reconstruction.mjs.txt"), previous);
await Bun.write(
  join(output.out, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "isolated-before-buff-observer-regression-baseline",
      currentReconstructionSha256: sha(currentBytes),
      previousReconstructionSha256: sha(new TextEncoder().encode(previous)),
      cli: {
        file: "inspect-previous-semantics.mjs",
        bytes: bundled.length,
        sha256: sha(bundled),
      },
      inputs,
      changes,
      scope: {
        onlySevenObserverAdditionsReversed: true,
        noServedFilesMutated: true,
        nativeProgramsOrGatesChanged: false,
        productionRendererAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    cli,
    manifest: join(output.out, "manifest.json"),
    inputs: Object.keys(inputs).length,
    currentReconstructionSha256: sha(currentBytes),
    previousReconstructionSha256: sha(new TextEncoder().encode(previous)),
  }),
);
