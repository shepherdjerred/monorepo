// Instrument the actual ordinary-session factory and client initialization
// sequence. Classification is proof-only; measured production CPU boundaries
// remain those returned by the unmodified client and session.
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";
import { LatestDirectEffectClient } from "../latest-direct-effect-client.mjs";
import { directInitializationBufferStats } from "../latest-direct-compiled-restore.mjs";
import { sha256 } from "../structural-comparison.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  producer = resolve(import.meta.dir, "inspect-direct-session.mjs"),
  source = await Bun.file(producer).text(),
  boundary = "let session, result;";
assert.equal(source.indexOf(boundary), source.lastIndexOf(boundary));
assert.ok(source.indexOf(boundary) > 0);
const setup = source
    .slice(0, source.indexOf(boundary))
    .replace(
      /\bfrom\s+(["'])(\.{1,2}\/[^"']+)\1/g,
      (_m, _q, relative) =>
        `from ${JSON.stringify(pathToFileURL(resolve(dirname(producer), relative)).href)}`,
    )
    .replaceAll("import.meta.dir", JSON.stringify(dirname(producer)))
    .replaceAll("import.meta.path", JSON.stringify(producer))
    .replaceAll(
      "direct-session-control.bundle.mjs",
      "direct-initialization-ownership.bundle.mjs",
    ),
  setupPath = `${cache}/research/direct-initialization-ownership.setup.mjs`;
await Bun.write(
  setupPath,
  setup +
    "\nexport {createLatestDirectEffectSession,THREE,report,scene,manifest,manifestBytes,pipeline,origin,load,inputs,originalFetch};\n",
);
const context = await import(pathToFileURL(setupPath).href),
  inputs = context.inputs;
for (const path of [import.meta.path, producer, setupPath])
  inputs[resolve(path)] = await sha256(await Bun.file(path).bytes());
function inventory(payload) {
  const buffers = new Map(),
    seen = new Set(),
    metadata = new Map(),
    encoder = new TextEncoder();
  const walk = (value, path) => {
    const scope =
      path
        .slice(0, path[0] === "packages" || path[0] === "world" ? 2 : 1)
        .join(".") || "root";
    if (!metadata.has(scope))
      metadata.set(scope, {
        path: scope,
        objects: 0,
        arrays: 0,
        ownKeysTraversed: 0,
        numberLeaves: 0,
        stringLeaves: 0,
        stringUtf8Bytes: 0,
        booleanLeaves: 0,
        nullishLeaves: 0,
      });
    const m = metadata.get(scope);
    if (value === null || value === undefined) {
      m.nullishLeaves++;
      return;
    }
    if (typeof value === "number") {
      m.numberLeaves++;
      return;
    }
    if (typeof value === "string") {
      m.stringLeaves++;
      m.stringUtf8Bytes += encoder.encode(value).length;
      return;
    }
    if (typeof value === "boolean") {
      m.booleanLeaves++;
      return;
    }
    if (typeof value !== "object")
      throw Error("Unexpected initialization metadata type");
    const buffer = ArrayBuffer.isView(value)
      ? value.buffer
      : value instanceof ArrayBuffer
        ? value
        : null;
    if (buffer) {
      if (!buffers.has(buffer))
        buffers.set(buffer, { bytes: buffer.byteLength, paths: [] });
      buffers.get(buffer).paths.push(path);
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    m.objects++;
    if (Array.isArray(value)) m.arrays++;
    m.ownKeysTraversed += Reflect.ownKeys(value).length;
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (Object.hasOwn(d, "value")) walk(d.value, [...path, String(key)]);
    }
  };
  walk(payload, []);
  const groups = (depth) => {
    const map = new Map();
    for (const value of buffers.values()) {
      const labels = new Set(
        value.paths.map((p) => p.slice(0, depth).join(".")),
      );
      for (const label of labels) {
        if (!map.has(label))
          map.set(label, {
            path: label,
            uniqueBufferBytes: 0,
            buffers: 0,
            sharedWithOtherGroupsBytes: 0,
          });
        const g = map.get(label);
        g.uniqueBufferBytes += value.bytes;
        g.buffers++;
        if (labels.size > 1) g.sharedWithOtherGroupsBytes += value.bytes;
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        b.uniqueBufferBytes - a.uniqueBufferBytes ||
        a.path.localeCompare(b.path),
    );
  };
  return {
    uniqueBuffers: buffers.size,
    uniqueBufferBytes: [...buffers.values()].reduce((n, b) => n + b.bytes, 0),
    topLevel: groups(1),
    secondLevel: groups(2),
    thirdLevel: groups(3).filter(
      (g) =>
        g.path.startsWith("packages.viewerPoseAssets.") ||
        g.path.startsWith("world."),
    ),
    captureFiles: payload.packages.compilationInputs
      .map(([path, b]) => ({ path, bytes: b.byteLength }))
      .sort((a, b) => b.bytes - a.bytes),
    transferCandidateGroups: [
      "packages.compilationInputs",
      "packages.viewerPoseAssets",
    ],
    transferInventoryMeasuredBeforeDetachment: true,
    metadataScopes: [...metadata.values()].sort(
      (a, b) => b.ownKeysTraversed - a.ownKeysTraversed,
    ),
    metadataCountsAreNotSerializedWireBytes: true,
  };
}
const original = LatestDirectEffectClient.prototype.initialize,
  measurements = [];
let session;
LatestDirectEffectClient.prototype.initialize = async function (
  payload,
  options,
) {
  const classified = inventory(payload),
    expected = directInitializationBufferStats(payload),
    compilationViews = payload.packages.compilationInputs.map(([, b]) => b),
    poseViews = Object.values(payload.packages.viewerPoseAssets.packages),
    result = await original.call(this, payload, options),
    transport = result.initializationTransport;
  for (const key of [
    "uniqueBuffers",
    "uniqueBufferBytes",
    "referencedViewBytes",
  ])
    assert.equal(transport[key], expected[key]);
  assert.equal(transport.explicitSessionOwnership, true);
  assert.equal(
    transport.transferredBuffers,
    compilationViews.length + poseViews.length,
  );
  assert.ok(transport.transferredBufferBytes > 90_000_000);
  assert.ok(
    [...compilationViews, ...poseViews].every((b) => b.byteLength === 0),
  );
  measurements.push({
    workerRecompile: result.compiledDefinitionValidation,
    transport,
    inventory: classified,
    transferredProducerViewsDetached: true,
  });
  return result;
};
try {
  session = await context.createLatestDirectEffectSession({
    world: new context.THREE.Group(),
    report: context.report,
    scene: context.scene,
    sceneManifestBytes: (await context.load("latest-scene/manifest.json"))
      .buffer,
    navigationMode: "loader-only-no-gpu",
    manifest: context.manifest,
    manifestBytes: context.manifestBytes.slice().buffer,
    pipeline: context.pipeline,
    missilePlayback: { traces: [], omitted: [] },
    assetBase: new URL("/assets/", context.origin).href,
  });
  assert.equal(measurements.length, 1);
  assert.equal(measurements[0].workerRecompile.mode, "normal");
  measurements[0].sessionInitialization = session.summary.sessionInitialization;
  assert.equal(
    session.summary.sessionInitialization.completeMainThreadCpuMeasured,
    false,
  );
  assert.ok(session.renderer.gpuMaterials.size > 0);
} finally {
  session?.close();
  if (session) await session.client.termination;
  LatestDirectEffectClient.prototype.initialize = original;
  globalThis.fetch = context.originalFetch;
}
for (const [path, hash] of Object.entries(inputs))
  assert.equal(
    await sha256(await Bun.file(path).bytes()),
    hash,
    `Final drift ${path}`,
  );
const output = `${cache}/research/direct-initialization-ownership-v33.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-session-initialization-buffer-ownership-and-cpu",
      inputs,
      measurements,
      scope: {
        actualOrdinaryFactory: true,
        actualClientValidationAccountingAndPostSequence: true,
        proofOnlyInstrumentation: true,
        classificationBeforeInitializationOutsideProductionTimer: true,
        sessionElapsedIncludesProofClassification: true,
        isolatedMemoryCopy: false,
        transfersPerformed: true,
        browserAcceptance: false,
        gpuSubmission: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    measurements: measurements.map((m) => ({
      transport: m.transport,
      sessionInitialization: m.sessionInitialization,
      uniqueBufferBytes: m.inventory.uniqueBufferBytes,
      groups: m.inventory.secondLevel.slice(0, 8),
    })),
  }),
);
