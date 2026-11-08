import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { compileDirectValueFloatMaximum as compile } from "../latest-direct-effect-value-maximum.mjs";
import { directEmitterLinkTimers } from "../latest-direct-effect-lifecycle.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Maximum input drift");
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
for (const path of [
  import.meta.path,
  "../structural-comparison.mjs",
  "../latest-direct-effect-value-maximum.mjs",
  "../latest-direct-effect-lifecycle.mjs",
])
  await raw(path.startsWith("../") ? resolve(import.meta.dir, path) : path);
const profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  native = await read(`${cache}/research/direct-value-maximum-native.json`);
if (
  (await sha256(image)) !== profile.decoderImageSha256 ||
  native.kind !== "native-singleton-value-float-maximum" ||
  native.schema !== 1 ||
  native.build !== "16.21.829.8620" ||
  native.protocol !== "20e09df23c66b85e" ||
  !Object.keys(native.inputs ?? {}).length ||
  !Object.keys(native.sources ?? {}).length
)
  throw Error("Pinned original maximum evidence required");
for (const map of [native.inputs, native.sources])
  for (const [path, digest] of Object.entries(map))
    if ((await sha256(await raw(path))) !== digest)
      throw Error(`Stale original maximum input: ${path}`);
const expectedRanges = new Set(["23952128:291", "23952784:11", "23992130:164"]);
// Require the complete original postload, maximum getter and timer consumer.
for (const block of native.originalBlocks ?? []) {
  if (
    !expectedRanges.delete(`${block.rva}:${block.size}`) ||
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
      block.sha256
  )
    throw Error("Unexpected original maximum instruction range");
}
if (expectedRanges.size)
  throw Error("Missing original maximum instruction range");
const bits = (v) => {
  const bytes = Buffer.alloc(4);
  bytes.writeFloatLE(v);
  return bytes.toString("hex");
};
let assertions = 0;
function exact(a, b, label) {
  assertions++;
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
function matrix(rows, expected, key) {
  if (!Array.isArray(rows) || rows.length !== expected.size)
    throw Error("Incomplete maximum matrix");
  const left = new Set(expected);
  for (const row of rows)
    if (!left.delete(key(row)))
      throw Error("Duplicate/unknown maximum control");
  if (left.size) throw Error("Missing maximum control");
}
matrix(
  native.cases,
  new Set([0, 2, 3].map((i) => `champions/karthus/10/ce863744:${i}`)),
  (r) => `${r.effectId}:${r.emitterIndex}`,
);
for (const row of native.cases) {
  const program = compile(row.source);
  if (!program || program.kind !== "singleton-resource")
    throw Error("Actual singleton compilation rejected");
  exact(
    bits(program.maximum),
    bits(row.virtualMaximum),
    "authored original virtual maximum",
  );
  exact(
    directEmitterLinkTimers({
      particleLifetime: program.maximum,
      lifetime: row.sourceLifetime,
      particleLinger: row.particleLinger,
      emitterLinger: row.emitterLinger,
    }),
    row.linkTimers,
    "original link timer consumer",
  );
  exact(
    row.completeOriginalFieldOrderPreserved,
    true,
    "original property order",
  );
  exact(
    [
      row.fieldRegistration.offset,
      row.fieldRegistration.type,
      row.fieldRegistration.mask,
    ],
    [248, 131, 0],
    "original lifetime field",
  );
}
const expected = new Set();
for (const t of [-1, 0, 0.5, 1])
  for (const v of [-4, -0, 0.125, 2, 4, 1e20])
    for (const c of [-17, 99, 1e10])
      expected.add(`${bits(t)}:${bits(v)}:${bits(c)}`);
matrix(
  native.controls,
  expected,
  (r) => `${bits(r.time)}:${bits(r.value)}:${bits(r.wrapperConstant)}`,
);
for (const row of native.controls) {
  const source = structuredClone(native.cases[0].source);
  source.constantValue = row.wrapperConstant;
  source.dynamics.times = [row.time];
  source.dynamics.values = [row.value];
  exact(
    bits(compile(source).maximum),
    row.cachedBits,
    "original singleton postload metadata bits",
  );
  exact(bits(row.maximum), row.cachedBits, "original virtual getter bits");
}
let rejectionControls = 0;
for (const rows of [
  native.controls.slice(1),
  [...native.controls.slice(1), native.controls[1]],
]) {
  try {
    matrix(
      rows,
      expected,
      (r) => `${bits(r.time)}:${bits(r.value)}:${bits(r.wrapperConstant)}`,
    );
  } catch {
    rejectionControls++;
  }
}
exact(rejectionControls, 2, "incomplete and duplicate evidence rejected");
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error("Final maximum provenance drift");
const output = `${cache}/research/direct-value-maximum-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "direct-value-float-maximum-comparison",
      build: native.build,
      protocol: native.protocol,
      inputs,
      assertions,
      mismatches: [],
      counts: {
        authoredComponents: native.cases.length,
        scalarControls: native.controls.length,
        rejectionControls,
      },
      scope: {
        originalSingletonPostloadAndVirtualMaximum: true,
        originalTimerConsumer: true,
        probabilityCompositionExcludedFromMetadataMaximum: true,
        multiKeyMaximum: false,
        runtimeLifecycleIntegration: false,
        renderedCoverage: false,
        nativeWorldAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    assertions,
    authored: native.cases.length,
    controls: native.controls.length,
  }),
);
