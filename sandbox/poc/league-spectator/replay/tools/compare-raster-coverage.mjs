// Identity-level coverage delta over immutable v31 and current actual raster.
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {},
  raw = async (path) => {
    const bytes = await Bun.file(path).bytes();
    inputs[path] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    return bytes;
  },
  read = async (path) => JSON.parse(new TextDecoder().decode(await raw(path))),
  old = await read(
    `${cache}/research/shared-direct-playback-offscreen-v31.json`,
  ),
  current = await read(
    process.argv[3]
      ? resolve(process.argv[3])
      : `${cache}/research/shared-direct-playback-offscreen.json`,
  ),
  worker = await read(`${cache}/research/shared-direct-playback-worker.json`),
  oldWorker = await read(
    `${cache}/research/shared-direct-playback-worker-v31-final.json`,
  ),
  report = (await read(`${cache}/research/viewer-root-reconstruction.json`))
    .report,
  key = (draw) =>
    JSON.stringify([
      draw.sourceEventId,
      draw.generation,
      draw.definitionId,
      draw.emitterId,
    ]),
  instance = (draw) => JSON.stringify([draw.sourceEventId, draw.generation]),
  flatten = (proof) =>
    proof.frames.flatMap((frame) =>
      frame.draws.map((draw) => ({ ...draw, time: frame.time })),
    ),
  oldPositive = new Map(
    flatten(old)
      .filter((draw) => draw.prefixFramebufferChangedPixels > 0)
      .map((draw) => [key(draw), draw]),
  ),
  submitted = flatten(current),
  positive = submitted.filter(
    (draw) => draw.prefixFramebufferChangedPixels > 0,
  ),
  currentPositive = new Map(positive.map((draw) => [key(draw), draw])),
  summarize = (identity) => {
    const [sourceEventId, generation, definitionId, emitterId] =
        JSON.parse(identity),
      samples = positive.filter((draw) => key(draw) === identity);
    let creation = null;
    const match = /^network-effect:([0-9]+):([0-9]+)$/.exec(sourceEventId);
    if (match) {
      const source = report.effectCreations[Number(match[2])];
      assert.equal(source.entityId, Number(match[1]));
      creation = {
        time: source.time,
        transportSequence: source.transportSequence,
        entryOrder: source.entryIndex,
        creationSequence: source.creationSequence,
        entityId: source.entityId,
        resourceContextEntityId: source.resourceContextEntityId,
        attachmentEntityId: source.attachmentEntityId,
        lookup14EntityId: source.lookup14EntityId,
        lookupA8EntityId: source.lookupA8EntityId,
      };
    }
    return {
      sourceEventId,
      generation,
      definitionId,
      emitterId,
      creation,
      preroll: creation !== null && creation.time < 69,
      positiveTimes: samples.map((draw) => draw.time),
      ownershipStatus: currentPositive.get(identity)?.ownershipStatus ?? null,
      creatorChampion: currentPositive.get(identity)?.creatorChampion ?? null,
    };
  },
  added = [...currentPositive.keys()]
    .filter((id) => !oldPositive.has(id))
    .sort()
    .map(summarize),
  removed = [...oldPositive.keys()]
    .filter((id) => !currentPositive.has(id))
    .sort()
    .map(summarize),
  submittedInstances = new Map(submitted.map((draw) => [instance(draw), draw])),
  positiveInstances = new Set(positive.map(instance)),
  nonContributingInstances = [...submittedInstances]
    .filter(([id]) => !positiveInstances.has(id))
    .map(([id, draw]) => ({
      sourceEventId: draw.sourceEventId,
      generation: draw.generation,
      components: [
        ...new Set(submitted.filter((d) => instance(d) === id).map(key)),
      ].map((component) => {
        const identity = summarize(component),
          samples = worker.snapshots.flatMap((frame) =>
            frame.draws
              .filter((draw) => key(draw) === component)
              .map((draw) => ({ time: frame.time, colors: draw.colors })),
          ),
          channels = samples.flatMap((sample) => sample.colors),
          alpha = channels.filter((_, index) => index % 4 === 3),
          rgb = channels.filter((_, index) => index % 4 !== 3);
        return {
          ...identity,
          submittedTimes: samples.map((sample) => sample.time),
          vertexRGBAllZero: rgb.every((value) => value === 0),
          vertexAlphaMinimum: Math.min(...alpha),
          vertexAlphaMaximum: Math.max(...alpha),
          prefixPixelsAboveTwoRGBLevels: 0,
        };
      }),
    })),
  preroll = [...submittedInstances.values()]
    .filter((draw) => {
      const first = summarize(key(draw));
      return first.preroll;
    })
    .map((draw) => ({
      sourceEventId: draw.sourceEventId,
      generation: draw.generation,
      creation: summarize(key(draw)).creation,
      submittedComponents: [
        ...new Set(
          submitted.filter((d) => instance(d) === instance(draw)).map(key),
        ),
      ].map((id) => JSON.parse(id)),
      positiveComponents: [...currentPositive.keys()]
        .filter((id) => JSON.parse(id)[0] === draw.sourceEventId)
        .map((id) => JSON.parse(id)),
    }));
await raw(import.meta.path);
assert.deepEqual(
  current.projection,
  old.projection,
  "Exact frozen comparison projection required",
);
assert.deepEqual(
  current.frames.map((frame) => frame.time),
  old.frames.map((frame) => frame.time),
  "Exact sample clock required",
);
assert.deepEqual(
  worker.snapshots.map((frame) => frame.camera),
  oldWorker.snapshots.map((frame) => frame.camera),
  "Exact sample camera required",
);
const result = {
  schema: 1,
  kind: "actual-raster-positive-component-delta-v31-to-v32",
  inputs,
  counts: {
    previousPositiveComponents: oldPositive.size,
    currentPositiveComponents: currentPositive.size,
    added: added.length,
    removed: removed.length,
    addedCreatedInComparisonWindow: added.filter(
      (row) =>
        row.creation && row.creation.time >= 69 && row.creation.time <= 99,
    ).length,
    addedPreroll: added.filter((row) => row.preroll).length,
    submittedInstances: submittedInstances.size,
    positiveInstances: positiveInstances.size,
  },
  added,
  removed,
  preroll,
  nonContributingInstances,
  scope: {
    immutableV31ComparedByExactBytes: true,
    exactProjectionCameraAndClockMatched: true,
    prefixContributionThresholdRGB: 2,
    prefixContributionEstablishesFinalPixelAttribution: false,
    assetFamilyInfersCreator: false,
    creatorChampions: current.counts.prefixContributingCreatorChampions,
  },
};
const output = process.argv[4]
  ? resolve(process.argv[4])
  : `${cache}/research/shared-direct-playback-coverage-delta-v32.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    counts: result.counts,
    creatorChampions: result.scope.creatorChampions,
  }),
);
