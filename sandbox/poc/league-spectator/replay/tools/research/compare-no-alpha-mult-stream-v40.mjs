import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { loadLatestDirectEffectPackage } from "../../latest-direct-effect-package.mjs";
import { loadLatestStaticCatalogSelection } from "../../latest-static-catalog.mjs";
import { compileLatestDirectEffect } from "../../latest-direct-effect-definition.mjs";
import { LatestDirectEffectRuntime } from "../../latest-direct-effect-runtime.mjs";
import { directGeometryBuffers } from "../../latest-direct-effect-draw.mjs";
import { projectDirectEmitterControl } from "../direct-emitter-control-projection.mjs";
import { captureDirectSourceInputs } from "../direct-source-inputs.mjs";
const output = resolve(
    ".cache/replay-spike/research/no-alpha-mult-stream-comparison-v40.json",
  ),
  inputs = {};
if (await Bun.file(output).exists())
  throw Error("Preserve immutable prior result");
const hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
async function raw(path, expected) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    h = hash(bytes);
  if (expected && h !== expected) throw Error("Input digest differs: " + path);
  if (inputs[path] && inputs[path] !== h) throw Error("Input drift: " + path);
  inputs[path] = h;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const native = JSON.parse(
    new TextDecoder().decode(
      await raw(
        ".cache/replay-spike/research/no-alpha-mult-stream-raster-v40.json",
        "96f3eead199044261a45cf7c6fbc035be3976b1cf33439b56e4566a0ea1efd95",
      ),
    ),
  ),
  rows = [];
for (const row of native.rows) {
  const cache = resolve(".cache", row.cache),
    load = (p) => raw(resolve(cache, "public", p)),
    catalog = await loadLatestStaticCatalogSelection({ load }),
    id = row.materialKey.slice(0, row.materialKey.lastIndexOf(":")),
    index = Number(row.materialKey.split(":").at(-1));
  const manifestBytes = await load("latest-effects/manifest.json"),
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    effectIds: [id],
    staticCatalog: catalog,
    captureCompilationInputs: false,
  });
  const d = await compileLatestDirectEffect({
      id,
      definitionBytes: await load(
        "latest-effects/" + manifest.definitions[id].file,
      ),
      manifest,
      manifestBytes,
      kernels: prepared.kernels,
    }),
    program = d.emitters.find((e) => e.index === index);
  assert.ok(
    program,
    "Unchanged actual component compiled before material conjunction",
  );
  assert.equal(
    prepared.definitions.get(id).emitters.some((e) => e.index === index),
    false,
    "Production no-alpha material still omitted",
  );
  const projected = projectDirectEmitterControl(d, program),
    runtime = new LatestDirectEffectRuntime({
      build: native.rows.length && "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      contentHash: d.contentHash,
      replayHash: "0".repeat(64),
      definitions: new Map([[id, projected]]),
      kernels: prepared.kernels,
      events: [
        {
          id: "no-alpha-component-control:0",
          kind: "create",
          origin: "animation",
          entityId: 1,
          definitionId: id,
          time: 0,
          transportSequence: 0,
          entryOrder: 0,
          seedHex: row.seedHex,
        },
      ],
      world: {
        placement: (_event, t) => ({
          resolved: true,
          boundObjectSize: 0,
          boundObjectSizeStatus: "supplied-native-default-zero-control",
          position: [t * 130, t * 3, t * 70],
          basis: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        }),
      },
    });
  let checked = 0,
    nonempty = 0;
  const mismatches = [];
  for (const frame of row.frames) {
    runtime.advanceTo(frame.input.time);
    const packet = runtime.generateDraws({
        right: frame.input.cameraRight,
        up: frame.input.cameraUp,
        position: frame.input.viewPosition,
      }),
      draw = packet.draws[0],
      packed = draw ? directGeometryBuffers(draw) : null,
      wanted = frame.output.geometry;
    if (
      (packed?.vertices.toHex() ?? "") !== wanted.verticesHex ||
      (packed?.indices.toHex() ?? "") !== wanted.indicesHex
    )
      mismatches.push({
        time: frame.input.time,
        actualVertices: packed?.vertices.toHex() ?? "",
        expectedVertices: wanted.verticesHex,
        actualIndices: packed?.indices.toHex() ?? "",
        expectedIndices: wanted.indicesHex,
      });
    checked++;
    if (packed?.vertices.byteLength) nonempty++;
  }
  rows.push({
    materialKey: row.materialKey,
    sourceDefinitionSha256: row.sourceDefinitionSha256,
    frames: checked,
    nonemptyFrames: nonempty,
    mismatches,
    productionMaterialStillOmitted: true,
    diagnosticProjection: projected.diagnosticRootProjection,
  });
  console.log(
    JSON.stringify({
      materialKey: row.materialKey,
      frames: checked,
      nonempty,
      mismatches: mismatches.length,
      example: mismatches[0],
    }),
  );
}
for (const [path, h] of Object.entries(inputs))
  assert.equal(
    hash(await Bun.file(path).bytes()),
    h,
    "Final input drift: " + path,
  );
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "unchanged-no-alpha-mult-current-kernel-vs-original-bound-stream-control",
      inputs,
      rows,
      counts: {
        frames: rows.reduce((n, r) => n + r.frames, 0),
        mismatches: rows.reduce((n, r) => n + r.mismatches.length, 0),
      },
      scope: {
        sameUnchangedSourceAndSuppliedUnitDefaultFlex: true,
        originalBoundWriterHasMultTexturePresenceTrue: true,
        exactPackedPositionColorPrimaryAndMultUvsAndIndices: true,
        productionMaterialStillOmitted: true,
        nativeParentActivation: false,
        matchPlacement: false,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ),
);
if (rows.some((r) => r.mismatches.length))
  throw Error("Current original-bound stream comparison differs");
console.log(
  JSON.stringify({
    output,
    sha256: hash(await Bun.file(output).bytes()),
    pass: true,
  }),
);
