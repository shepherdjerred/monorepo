// Copy only independently approved build programs; no per-definition materials.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { SELECTED_BUILD_PROGRAMS } from "./selected-build-programs.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-selected-build-programs.mjs <source-cache> <selected-cache>",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg),
  inputs = {},
  outputs = {};
if (source === target || /[\\/]hs(?:[\\/]|$)/i.test(target))
  throw Error("Physically separate non-hs static target required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
for (const [path, expected] of SELECTED_BUILD_PROGRAMS) {
  const bytes = await raw(`${source}/public/${path}`);
  if ((await sha256(bytes)) !== expected)
    throw Error("Original approved build program required: " + path);
  const output = `${target}/public/${path}`,
    file = Bun.file(output);
  if (await file.exists()) {
    if ((await sha256(await file.bytes())) !== expected)
      throw Error("Cannot replace differing selected build program: " + path);
  } else await Bun.write(output, bytes);
  if ((await sha256(await Bun.file(output).bytes())) !== expected)
    throw Error("Build program copy readback differs");
  outputs[resolve(output)] = expected;
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Build source changed: " + path);
await Bun.write(
  `${target}/research/selected-build-programs-preparation.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "fixed-approved-build-program-snapshot",
      inputs,
      outputs,
      scope: {
        nativeProgramApprovalsUnchanged: true,
        definitionMaterialsCopied: false,
        renderedCoverage: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ outputs }));
