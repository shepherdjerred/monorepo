// Actual shared renderer load/prepare/commit, in Bun with real THREE and workers.
// No DOM, browser, bitmap shim or substituted material/worker implementation.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { LatestParticleFrameGate } from "../latest-particle-frame-gate.mjs";
import { LatestPreparedEffectPlayback } from "../latest-prepared-effect-playback.mjs";
import { LatestEffectLookahead } from "../latest-effect-lookahead.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
const raw = async (p) => {
  const b = new Uint8Array(await Bun.file(p).arrayBuffer());
  inputs[p] = sha(b);
  return b;
};
const read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const check = (ok, m) => {
  if (!ok) throw Error(m);
};
const fixture = await read(`${cache}/research/bound-vfx-playback.json`),
  nativeBytes = await raw(`${cache}/research/parent-missiles-native.json`),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  proof = await read(`${cache}/research/parent-timeline.json`);
check(
  proof.nativeObservationSha256 === sha(nativeBytes) &&
    proof.mismatchCount === 0 &&
    proof.counts.canonicalWorldComparisons === 2,
  "Timeline lacks complete native/state comparison",
);
for (const [name, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === digest,
    `Timeline producer changed: ${name}`,
  );
const bundle = await Bun.build({
  entrypoints: [`${root}/latest-parent-missile-renderer.mjs`],
  target: "bun",
  write: false,
  external: ["/assets/*"],
  plugins: [
    {
      name: "pinned-three",
      setup(build) {
        build.onResolve({ filter: /^three$/ }, () => ({
          path: `${assets}/vendor/three.module.js`,
        }));
      },
    },
  ],
});
check(
  bundle.success && bundle.outputs.length === 1,
  "Parent viewer CLI bundle failed",
);
const bundlePath = `${cache}/research/parent-viewer.bundle.mjs`;
await Bun.write(bundlePath, bundle.outputs[0]);
const { LatestParentMissileRenderer } = await import(
    pathToFileURL(bundlePath).href
  ),
  THREE = await import(pathToFileURL(`${assets}/vendor/three.module.js`).href);
const manifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const world = new THREE.Group();
world.scale.z = -1;
const camera = new THREE.OrthographicCamera(-2000, 2000, 2000, -2000, 5, 60000);
camera.matrixAutoUpdate = false;
camera.matrix.set(1, 0, 0, 12000, 0, 0, 1, 12000, 0, -1, 0, 0, 0, 0, 0, 1);
camera.matrixWorldNeedsUpdate = true;
const renderer = new LatestParentMissileRenderer(
  world,
  manifest,
  manifestBytes,
  {
    assetBase: "http://127.0.0.1:4180/assets/",
    workerUrl: new URL("../latest-parent-worker.mjs", import.meta.url),
    runtimeModuleUrl: pathToFileURL(
      `${assets}/vendor/unicorn_x86_candidate.mjs`,
    ).href,
  },
);
const hex = (b) =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");
function rebuild(g) {
  const n = g.attributes.a_POSITION.count,
    vertices = new Uint8Array(n * 28),
    view = new DataView(vertices.buffer),
    indices = new Uint8Array(g.index.count * 2),
    iv = new DataView(indices.buffer);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 3; j++)
      view.setFloat32(
        i * 28 + j * 4,
        g.attributes.a_POSITION.array[i * 3 + j],
        true,
      );
    vertices.set(
      g.attributes.a_COLOR.array.subarray(i * 4, i * 4 + 4),
      i * 28 + 12,
    );
    for (let j = 0; j < 4; j++)
      view.setUint16(
        i * 28 + 16 + j * 2,
        g.attributes.a_TEXCOORD.array[i * 4 + j],
        true,
      );
    for (let j = 0; j < 2; j++)
      view.setUint16(
        i * 28 + 24 + j * 2,
        g.attributes.a_TEXCOORD1.array[i * 2 + j],
        true,
      );
  }
  for (let i = 0; i < g.index.count; i++)
    iv.setUint16(i * 2, g.index.array[i], true);
  return { verticesHex: hex(vertices), indicesHex: hex(indices) };
}
const counts = {
  canonicalFrames: 0,
  nativeDrawComparisons: 0,
  reverseSeeks: 0,
  disabledFrames: 0,
  repeatedFrameCacheHits: 0,
  staleCommitsPrevented: 0,
  completedIdleWithoutWorkerRequests: 0,
  disposedRejections: 0,
  loadOwnershipRejections: 0,
  pendingDisposalRejections: 0,
};
const captures = [],
  materials = {},
  timings = [],
  began = performance.now();
let preparedPlayback;
let automaticPlayback;
try {
  await renderer.load({ traces: fixture.traces });
  try {
    await renderer.load({ traces: fixture.traces });
    throw Error("Repeated renderer load accepted");
  } catch (e) {
    check(
      e.message === "Parent missile renderer must be loaded once",
      "Wrong repeated-load rejection",
    );
    counts.loadOwnershipRejections++;
  }
  const invalid = new LatestParentMissileRenderer(
    new THREE.Group(),
    manifest,
    manifestBytes,
    { assetBase: "http://127.0.0.1:4180/assets/" },
  );
  try {
    await invalid.load({
      traces: [
        {
          ...fixture.traces[0],
          effect: {
            ...fixture.traces[0].effect,
            definitionSha256: "0".repeat(64),
          },
        },
      ],
    });
    throw Error("Mismatched definition accepted");
  } catch (e) {
    check(
      e.message ===
        "Parent missile effect binding differs from the matching asset manifest",
      "Wrong changed-definition rejection",
    );
    counts.loadOwnershipRejections++;
  } finally {
    invalid.dispose();
  }
  check(
    renderer.summary.bursts === 2 &&
      renderer.summary.traces === 30 &&
      renderer.summary.supportedEmitters === 11,
    "Viewer parent admission differs",
  );
  check(
    renderer.gpuMaterials.size === 11 &&
      [...renderer.textures.values()].every(
        (t) =>
          t.isDataTexture &&
          t.colorSpace === THREE.NoColorSpace &&
          !t.flipY &&
          !t.generateMipmaps,
      ),
    "Actual material/texture loading contract differs",
  );
  const factors = new Map([
    [THREE.OneFactor, 1],
    [THREE.SrcAlphaFactor, 0x302],
    [THREE.OneMinusSrcAlphaFactor, 0x303],
  ]);
  for (const [key, { prepared, material }] of renderer.gpuMaterials) {
    const blend = [
      material.blendSrc,
      material.blendSrcAlpha,
      material.blendDst,
      material.blendDstAlpha,
    ].map((f) => factors.get(f));
    check(blend.every(Number.isInteger), "Unprepared actual blend factor");
    materials[key] = {
      shaders: prepared.shaders,
      vertexShader: material.vertexShader,
      fragmentShader: material.fragmentShader,
      blend,
      depthTest: material.depthTest,
      depthWrite: material.depthWrite,
      side: material.side,
    };
  }
  const commit = async (time) => {
    const start = performance.now(),
      frame = await renderer.prepareFrame(time, camera);
    renderer.commitFrame(frame);
    timings.push({ time, elapsedMs: performance.now() - start });
    return frame;
  };
  const compare = (frame, expected) => {
    check(
      isDeepStrictEqual(frame.stage.camera, fixture.camera),
      `Actual THREE camera transform differs from native probe: ${JSON.stringify(frame.stage.camera, (_k, v) => (Object.is(v, -0) ? "-0" : v))}`,
    );
    for (const p of expected.parents)
      for (const geometry of p.geometry) {
        const mesh = renderer.parentMeshes
          .get(p.sequence)
          .get(geometry.emitterIndex);
        if (!geometry.indicesHex.length) {
          check(
            !mesh || !mesh.visible,
            "Empty native pool retained a visible mesh",
          );
          continue;
        }
        check(mesh?.visible, "Native geometry has no committed visible mesh");
        const actual = rebuild(mesh.geometry);
        check(
          actual.verticesHex === geometry.verticesHex &&
            actual.indicesHex === geometry.indicesHex,
          "Actual load/prepare/commit changed native geometry",
        );
        counts.nativeDrawComparisons++;
      }
  };
  for (let bi = 0; bi < native.cases.length; bi++) {
    const reference = native.cases[bi];
    const points = reference.frames[5].parents
      .flatMap((p) => p.geometry)
      .flatMap((g) => {
        const b = Buffer.from(g.verticesHex, "hex"),
          positions = [];
        for (let o = 0; o < b.length; o += 28)
          positions.push([b.readFloatLE(o), b.readFloatLE(o + 8)]);
        return positions;
      });
    const lo = [0, 1].map((i) => Math.min(...points.map((p) => p[i]))),
      hi = [0, 1].map((i) => Math.max(...points.map((p) => p[i]))),
      center = lo.map((v, i) => (v + hi[i]) / 2),
      extent = Math.max(...hi.map((v, i) => v - lo[i])) * 0.6;
    camera.left = center[0] - 12000 - extent;
    camera.right = center[0] - 12000 + extent;
    camera.top = center[1] + extent;
    camera.bottom = center[1] - extent;
    camera.updateProjectionMatrix();
    for (let fi = 0; fi < reference.frames.length; fi++) {
      const expected = reference.frames[fi],
        frame = await commit(expected.time);
      compare(frame, expected);
      counts.canonicalFrames++;
      if (fi === 5) {
        const geometry = frame.stage.draws
          .filter((d) => d.attributes.index.length)
          .map((draw) => {
            const mesh = renderer.parentMeshes
                .get(draw.key)
                .get(draw.emitterIndex),
              binding = renderer.gpuMaterials.get(draw.materialKey);
            check(
              mesh.material === binding.material &&
                mesh.renderOrder === binding.prepared.suppliedSortPass,
              "Committed material/pass differs",
            );
            return {
              sequence: draw.key,
              emitterIndex: draw.emitterIndex,
              kind: draw.kind,
              particleCount: draw.particleCount,
              ...rebuild(mesh.geometry),
              materialKey: draw.materialKey,
              sortPass: mesh.renderOrder,
              blocks: binding.material.uniformsGroups.map((group) => {
                const block = [...renderer.uniformGroups.values()].find(
                  (b) => b.group === group,
                );
                return {
                  name: group.name,
                  bytesHex: hex(
                    new Uint8Array(
                      block.data.buffer,
                      block.data.byteOffset,
                      block.data.byteLength,
                    ),
                  ),
                };
              }),
              textures: Object.fromEntries(
                Object.entries(binding.material.uniforms).map(([name, u]) => [
                  name,
                  {
                    width: u.value.image.width,
                    height: u.value.image.height,
                    sha256: sha(u.value.image.data),
                    wrapS: u.value.wrapS,
                    wrapT: u.value.wrapT,
                    minFilter: u.value.minFilter,
                    magFilter: u.value.magFilter,
                  },
                ]),
              ),
            };
          });
        captures.push({
          effectId: reference.effectId,
          startTime: reference.startTime,
          time: expected.time,
          camera: frame.stage.camera,
          projectionRows: frame.rows,
          geometry,
        });
        const again = await renderer.prepareFrame(expected.time, camera);
        check(
          again === frame,
          "Repeated committed frame did not reuse its owned packet",
        );
        counts.repeatedFrameCacheHits++;
      }
    }
    for (const fi of [5, 2, 12]) {
      const frame = await commit(reference.frames[fi].time);
      compare(frame, reference.frames[fi]);
      counts.reverseSeeks++;
    }
    console.log(
      JSON.stringify({ burst: bi, elapsedMs: performance.now() - began }),
    );
  }
  renderer.enabled = false;
  const disabled = await commit(88);
  check(
    renderer.stats.visibleParticles === 0 &&
      [...renderer.meshes.values()].every((m) => !m.visible),
    "Disabled frame retained particles",
  );
  counts.disabledFrames++;
  renderer.enabled = true;
  const restored = await commit(native.cases[0].frames[5].time);
  compare(restored, native.cases[0].frames[5]);
  const gate = new LatestParticleFrameGate();
  let committed = 0,
    error;
  gate.start(
    () => renderer.prepareFrame(native.cases[0].frames[6].time, camera),
    () => committed++,
    (e) => {
      error = e;
    },
  );
  gate.invalidate();
  await gate.pending;
  check(!committed && !error, "Invalidated complete frame reached commit");
  counts.staleCommitsPrevented++;
  await commit(200);
  const ids = renderer.playback.contexts.map((c) => c.client.nextId);
  await commit(201);
  check(
    isDeepStrictEqual(
      ids,
      renderer.playback.contexts.map((c) => c.client.nextId),
    ) && renderer.stats.visibleParticles === 0,
    "Completed idle viewer requested further simulation",
  );
  counts.completedIdleWithoutWorkerRequests++;
  const rewind = await commit(native.cases[0].frames[5].time);
  compare(rewind, native.cases[0].frames[5]);
  counts.reverseSeeks++;
  const buffered = new LatestPreparedEffectPlayback();
  const start = native.cases[0].startTime;
  const times = Array.from({ length: 121 }, (_, i) =>
    Math.fround(start + (i - 15) / 60),
  );
  let progress = 0;
  check(
    await buffered.prepare({
      effects: renderer,
      camera,
      times,
      onProgress: ({ completed }) => {
        progress = completed;
      },
    }),
    "Prepared playback was unexpectedly cancelled",
  );
  check(
    progress === 121 && buffered.frames.length === 121,
    "Prepared playback omitted frames",
  );
  const digestStage = (frame) => {
    const hash = new Bun.CryptoHasher("sha256");
    hash.update(JSON.stringify([frame.time, frame.rows, frame.stage.camera]));
    for (const draw of frame.stage.draws) {
      hash.update(
        JSON.stringify([
          draw.key,
          draw.emitterIndex,
          draw.kind,
          draw.particleCount,
        ]),
      );
      for (const bytes of [...Object.values(draw.attributes), draw.drawBytes])
        hash.update(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        );
    }
    return hash.digest("hex");
  };
  const before = buffered.frames.map(digestStage),
    requestIds = renderer.playback.contexts.map((c) => c.client.nextId),
    commits = [],
    activeCommits = [];
  for (const time of [...times, ...times.toReversed()]) {
    const began = performance.now(),
      frame = buffered.sample(time);
    check(
      frame.time === time,
      "Prepared playback changed an exact frame timestamp",
    );
    renderer.commitFrame(frame);
    commits.push(performance.now() - began);
    if (frame.stage.draws.some((draw) => draw.attributes.index.length))
      activeCommits.push(commits.at(-1));
    for (const draw of frame.stage.draws) {
      if (!draw.attributes.index.length) continue;
      const mesh = renderer.parentMeshes.get(draw.key).get(draw.emitterIndex);
      for (const [name, bytes] of Object.entries(draw.attributes)) {
        const actual =
          name === "index"
            ? mesh.geometry.index.array
            : mesh.geometry.attributes[name].array;
        check(
          isDeepStrictEqual(actual, bytes),
          "Prepared replay changed committed native geometry",
        );
      }
    }
  }
  check(
    isDeepStrictEqual(before, buffered.frames.map(digestStage)),
    "GPU updates mutated retained frames",
  );
  check(
    isDeepStrictEqual(
      requestIds,
      renderer.playback.contexts.map((c) => c.client.nextId),
    ),
    "Prepared playback requested native simulation while presenting frames",
  );
  const sorted = commits.toSorted((a, b) => a - b);
  const activeSorted = activeCommits.toSorted((a, b) => a - b);
  check(
    activeSorted.length > 0,
    "Prepared playback contained no visible effects",
  );
  preparedPlayback = {
    frames: buffered.frames.length,
    presentations: commits.length,
    bytes: buffered.bytes,
    preparationMs: buffered.preparationMs,
    workerRequestsWhilePresenting: 0,
    retainedGeometryMismatches: 0,
    cpuCommit: {
      medianMs: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: sorted.at(-1),
    },
    activePresentations: activeSorted.length,
    activeCpuCommit: {
      medianMs: activeSorted[Math.floor(activeSorted.length * 0.5)],
      p95Ms: activeSorted[Math.floor(activeSorted.length * 0.95)],
      maxMs: activeSorted.at(-1),
    },
    scope: { browserExecuted: false, gpuSubmission: false, cameraFixed: true },
  };
  buffered.clear();
  const lookahead = new LatestEffectLookahead(renderer);
  const speedCounts = { 1: 0, 4: 0 };
  let automaticPresentations = 0,
    movingCameraFrames = 0;
  const automaticPreparations = [];
  for (let wi = 0; wi < lookahead.windows.length; wi++) {
    const window = lookahead.windows[wi];
    const cameraAt = (time) => {
      const view = camera.clone();
      if (wi === 1) {
        view.matrix.elements[12] += (time - window.origin) * 100;
        view.matrixWorldNeedsUpdate = true;
      }
      return view;
    };
    check(
      lookahead.required(window.start) === window,
      "An unprepared effect window was allowed to play invisibly",
    );
    const began = performance.now();
    await lookahead.prefetch({
      time: window.start - 1,
      speed: 4,
      playing: true,
      cameraAt,
    });
    if (lookahead.error) throw lookahead.error;
    automaticPreparations.push(performance.now() - began);
    check(
      !lookahead.required(window.start) && window.complete,
      "Prepared native effect window did not become playable",
    );
    const requestIds = renderer.playback.contexts.map((c) => c.client.nextId);
    for (const speed of [1, 4]) {
      for (let tick = 0; ; tick++) {
        const time = window.start + (tick * speed) / 60;
        if (time > window.end) break;
        const presentation = lookahead.presentation(time);
        check(
          presentation &&
            presentation.frame.time <= time &&
            time - presentation.frame.time < 1 / 60 + 0.00002,
          "Automatic playback lost or desynchronized a prepared effect frame",
        );
        renderer.commitFrame(presentation.frame);
        automaticPresentations++;
        if (renderer.stats.visibleParticles > 0) speedCounts[speed]++;
        if (wi === 1) {
          check(
            presentation.camera.matrix.equals(
              cameraAt(presentation.frame.time).matrix,
            ),
            "Automatic effect playback used the wrong follow-camera pose",
          );
          movingCameraFrames++;
        }
      }
    }
    for (const time of [
      window.origin + 0.2,
      window.origin + 0.1,
      window.origin + 0.2,
    ]) {
      const presentation = lookahead.presentation(time);
      check(presentation, "Paused/backward seek lost the buffered effect");
      renderer.commitFrame(presentation.frame);
    }
    check(
      isDeepStrictEqual(
        requestIds,
        renderer.playback.contexts.map((c) => c.client.nextId),
      ),
      "Automatic playback issued simulation work while presenting cached frames",
    );
  }
  check(
    speedCounts[1] > 0 && speedCounts[4] > 0 && movingCameraFrames > 0,
    "Automatic playback produced no visible effects at a requested speed",
  );
  lookahead.invalidate();
  check(
    lookahead.required(lookahead.windows[0].origin) !== null &&
      lookahead.presentation(lookahead.windows[0].origin) === null,
    "A camera change reused stale prepared effect geometry",
  );
  automaticPlayback = {
    windows: lookahead.windows.length,
    presentations: automaticPresentations,
    visiblePresentationsAtSpeed: speedCounts,
    movingCameraFrames,
    preparationMs: automaticPreparations,
    workerRequestsWhilePresenting: 0,
    cameraInvalidationChecked: true,
    pausedAndBackwardSeeks: 6,
    scope: {
      browserExecuted: false,
      gpuSubmission: false,
      actualSharedRenderer: true,
    },
  };
  const pending = renderer.prepareFrame(native.cases[0].frames[6].time, camera);
  renderer.dispose();
  try {
    await pending;
    throw Error("Disposed pending presentation accepted");
  } catch (e) {
    check(e.name === "AbortError", "Wrong in-flight disposal rejection");
    counts.pendingDisposalRejections++;
  }
  await renderer.playback.termination;
  try {
    await renderer.prepareFrame(75, camera);
    throw Error("Disposed renderer accepted work");
  } catch (e) {
    check(e.name === "AbortError", "Wrong disposed renderer rejection");
    counts.disposedRejections++;
  }
  try {
    renderer.commitFrame(restored);
    throw Error("Disposed renderer accepted commit");
  } catch (e) {
    check(
      e.message === "Unowned or disposed parent missile presentation",
      "Wrong disposed commit rejection",
    );
    counts.disposedRejections++;
  }
  check(
    world.children.length === 0 && renderer.meshes.size === 0,
    "Disposed parent viewer retained resources",
  );
} finally {
  renderer.dispose();
  await renderer.playback?.termination;
}
const browser = await Bun.build({
  entrypoints: [`${root}/latest-viewer.mjs`],
  target: "browser",
  write: false,
  external: ["three", "/assets/*"],
});
check(browser.success, "Main viewer browser bundle failed");
const sources = {};
for (const name of [
  "latest-viewer.mjs",
  "latest-prepared-effect-playback.mjs",
  "latest-effect-lookahead.mjs",
  "latest-effect-contexts.mjs",
  "latest-effect-resolvers.mjs",
  "latest-parent-missile-renderer.mjs",
  "latest-parent-missile-playback.mjs",
  "latest-parent-renderer.mjs",
  "latest-parent-render-frame.mjs",
  "latest-particle-frame-gate.mjs",
  "latest-parent-missile-timeline.mjs",
  "latest-parent-missile-inputs.mjs",
  "latest-missile-playback.mjs",
  "latest-parent-frames.mjs",
  "latest-world-effect-abi.mjs",
  "latest-world-descriptor-abi.mjs",
  "latest-parent-placement.mjs",
  "latest-parent-worker.mjs",
  "latest-parent-worker-client.mjs",
  "latest-particle-worker-client.mjs",
  "latest-parent-math.mjs",
  "latest-math-isa.mjs",
  "latest-fused-math.mjs",
  "latest-unicorn-bulk.mjs",
  "native-decoder.mjs",
  "latest-vfx-spawn.mjs",
  "structural-comparison.mjs",
  "latest-vfx-bound-renderer.mjs",
  "latest-vfx-renderer.mjs",
  "latest-trail-renderer.mjs",
  "tools/prepare-parent-textures.py",
  "tools/inspect-parent-viewer.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
for (const file of [
  bundlePath,
  `${assets}/vendor/three.module.js`,
  `${assets}/vendor/three.core.js`,
  `${assets}/latest-parent-textures/package.json`,
])
  await raw(file);
const result = {
  schema: 1,
  kind: "complete-parent-viewer-flow-comparison",
  nativeObservationSha256: sha(nativeBytes),
  inputs,
  sources,
  counts,
  captures,
  materials,
  timings,
  preparedPlayback,
  automaticPlayback,
  mismatchCount: 0,
  elapsedMs: performance.now() - began,
  scope: {
    actualThreeLoadPrepareCommit: true,
    actualRgbaDataTextures: true,
    realBunModuleWorkers: true,
    nativeGeometryCompared: true,
    mainViewerSourceIntegrated: true,
    browserBundleBuilt: true,
    independentBirthContexts: true,
    suppliedLifetimeSeedBasisAndSceneInputs: true,
    threeGpuSubmissionObserved: false,
    browserExecuted: false,
    referenceCompared: false,
    realTimePlaybackEstablished: false,
  },
};
await Bun.write(
  `${cache}/research/parent-viewer.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    counts,
    preparedPlayback,
    automaticPlayback,
    mismatchCount: 0,
  }),
);
