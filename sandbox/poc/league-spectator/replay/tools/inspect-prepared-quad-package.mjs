import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

// Conditional instruction/data parity and a separate preview-math comparison.
// Recorded library outputs are admitted only after exact name/argument checks.
export async function inspectPreparedQuadPackage(options) {
  const [packagePath, nativePath, outputPath] = options.argv;
  if (!outputPath)
    throw Error("Expected <decoder> <native evidence> <comparison output>");
  const root = resolve(packagePath),
    hash = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
    profile = await Bun.file(`${root}/profile.json`).json(),
    metaRaw = await Bun.file(`${root}/${options.metadataFile}`).arrayBuffer(),
    meta = JSON.parse(new TextDecoder().decode(metaRaw)),
    postRaw = await Bun.file(`${root}/vfx-postload.json`).arrayBuffer(),
    post = JSON.parse(new TextDecoder().decode(postRaw)),
    nativeRaw = await Bun.file(nativePath).arrayBuffer(),
    native = JSON.parse(new TextDecoder().decode(nativeRaw)),
    image = new Uint8Array(await Bun.file(`${root}/image.bin`).arrayBuffer()),
    vendor = resolve(dirname(root), "vendor/unicorn_x86_candidate.mjs"),
    canonical = (v) =>
      JSON.stringify(v, (_k, n) =>
        typeof n === "number" && Object.is(n, -0)
          ? "negative-zero"
          : n && typeof n === "object" && !Array.isArray(n)
            ? Object.fromEntries(
                Object.entries(n).sort(([a], [b]) => a.localeCompare(b)),
              )
            : n,
      );
  if (
    native.definitionSha256 !== hash(metaRaw) ||
    native.decoderImageSha256 !== hash(image) ||
    native.build !== profile.clientVersion ||
    native.protocol !== profile.protocolDigest ||
    hash(await Bun.file(vendor).arrayBuffer()) !== meta.runtimeSha256 ||
    hash(
      await Bun.file(
        new URL(options.observerFile, import.meta.url),
      ).arrayBuffer(),
    ) !== native.observerSha256
  )
    throw Error("Prepared quad native evidence mismatch");
  for (const [name, digest] of Object.entries(meta.compilerSources))
    if (
      native.compilerSources[name] !== digest ||
      hash(await Bun.file(new URL(name, import.meta.url)).arrayBuffer()) !==
        digest
    )
      throw Error(`Stale prepared quad compiler ${name}`);
  for (const block of native.originalBlocks)
    if (
      hash(image.subarray(block.rva, block.rva + block.size)) !== block.sha256
    )
      throw Error("Prepared quad original code changed");
  const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
    uc = await createUnicorn(),
    runtime = await options.createRuntime(
      uc,
      profile,
      image,
      await Bun.file(`${root}/vfx-spawn.json`).arrayBuffer(),
      await Bun.file(`${root}/vfx-emitter.json`).arrayBuffer(),
      postRaw,
      metaRaw,
      await Bun.file(`${root}/${meta.templates[0].file}`).arrayBuffer(),
    ),
    handles = new Map(),
    mismatches = [],
    previewMismatches = [],
    actors = {},
    previewMath = runtime.kernel.math,
    cacheStates = new Set();
  let frames = 0,
    births = 0,
    vertices = 0,
    indices = 0,
    checkpointFrames = 0,
    crossGraphRestores = 0,
    repeatFrames = 0,
    completeAssetByteChecks = 0,
    libraryQueue = [],
    libraryCursor = 0,
    libraryCalls = 0,
    previewFrames = 0,
    previewPositionMaxAbsoluteDifference = 0,
    previewGeometryLengthDifferences = 0,
    cameraCacheChecks = 0;
  const nativeNames = {
      sincosf: "___sincosf_stret",
      sinf: "_sinf",
      cosf: "_cosf",
      sqrtf: "_sqrtf",
      acosf: "_acosf",
      atan2f: "_atan2f",
      fmodf: "_fmodf",
      powf: "_powf",
      expf: "_expf",
      modff: "_modff",
    },
    oracleMath = Object.fromEntries(
      Object.entries(nativeNames).map(([name, nativeName]) => [
        name,
        (...args) => {
          const expected = libraryQueue[libraryCursor++];
          if (
            !expected ||
            expected.name !== nativeName ||
            expected.args.some((v, i) => !Object.is(v, args[i]))
          )
            throw Error(
              `Native-host library input differs: ${nativeName} at call ${libraryCursor - 1}`,
            );
          libraryCalls++;
          return name === "sincosf"
            ? [...expected.result]
            : name === "modff"
              ? { fraction: expected.result[0], integer: expected.integer }
              : expected.result[0];
        },
      ]),
    );
  function derived(frame) {
    if (!options.cameraCache) return;
    const digest = hash(
      runtime.kernel.read(
        meta.cameraCacheAddress + meta.cameraCacheDataOffset,
        meta.cameraCacheDataBytes,
      ),
    );
    if (digest !== frame.cameraCacheSha256)
      throw Error("Original camera rotation cache differs");
    cameraCacheChecks++;
    cacheStates.add(digest);
  }
  function oracleFrame(frame) {
    if (!Array.isArray(frame.libraryInputs))
      throw Error("Native library inputs missing");
    libraryQueue = frame.libraryInputs;
    libraryCursor = 0;
    runtime.kernel.math = oracleMath;
    const actual = runtime.frame(frame.input);
    if (libraryCursor !== libraryQueue.length)
      throw Error("Unconsumed native library input observations");
    derived(frame);
    return actual;
  }
  function oracleReset(seed, quality) {
    libraryQueue = [];
    libraryCursor = 0;
    runtime.kernel.math = oracleMath;
    runtime.reset(seed, quality);
  }
  function compare(actual, expected, detail, target = mismatches) {
    if (canonical(actual) === canonical(expected)) return;
    const fields = [];
    function walk(a, b, path) {
      if (canonical(a) === canonical(b) || fields.length >= 4) return;
      if (a && b && typeof a === "object" && typeof b === "object")
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
          walk(a[key], b[key], `${path}.${key}`);
      else
        fields.push({
          path,
          actual: String(a).slice(0, 100),
          expected: String(b).slice(0, 100),
        });
    }
    walk(actual, expected, "output");
    target.push({ ...detail, fields });
    if (target === mismatches && mismatches.length <= 4)
      console.log(JSON.stringify(mismatches.at(-1)));
  }
  try {
    for (const ref of meta.templates) {
      const raw = await Bun.file(`${root}/${ref.file}`).arrayBuffer(),
        graph = JSON.parse(new TextDecoder().decode(raw)),
        source = post.emitters[`${ref.effectId}:${ref.emitterIndex}`],
        sourceRaw = await Bun.file(`${root}/${source.file}`).arrayBuffer(),
        state = JSON.parse(new TextDecoder().decode(sourceRaw));
      if (
        hash(raw) !== ref.sha256 ||
        hash(sourceRaw) !== ref.postloadGraphSha256 ||
        graph.segments.length !== 2 ||
        graph.segments[0].address !== 0x10020000 ||
        graph.segments[0].bytesHex.length !== 0x20000 ||
        graph.segments[0].bytesHex.slice(0, 0x8e0) !== state.objectHex ||
        graph.assetObjectHex !== state.objectHex ||
        graph.segments[1].address !== state.heapStart ||
        graph.segments[1].bytesHex !== state.heapHex ||
        graph.nextHeap !== state.heapStart + state.heapHex.length / 2
      )
        throw Error("Complete prepared asset bytes were changed or omitted");
      completeAssetByteChecks += 0x470 + state.heapHex.length / 2;
      handles.set(ref.sha256, await runtime.loadGraph(raw));
      const actor = ref.effectId.slice(0, ref.effectId.lastIndexOf("/"));
      actors[actor] ??= { graphs: 0, frames: 0, births: 0, vertices: 0 };
      actors[actor].graphs++;
    }
    for (const [ci, c] of native.cases.entries()) {
      const handle = handles.get(c.graphSha256);
      if (!handle) throw Error("Native case outside prepared quad package");
      const actor = handle.effectId.slice(0, handle.effectId.lastIndexOf("/"));
      runtime.selectGraph(handle);
      oracleReset(BigInt(`0x${c.seedHex}`), c.quality);
      let saved = null;
      for (const [i, f] of c.frames.entries()) {
        const actual = oracleFrame(f);
        compare(actual, f.output, { case: ci, frame: i, kind: "forward" });
        frames++;
        births += actual.state.births.length;
        vertices += actual.geometry.verticesHex.length / 56;
        indices += actual.geometry.indicesHex.length / 4;
        actors[actor].frames++;
        actors[actor].births += actual.state.births.length;
        actors[actor].vertices += actual.geometry.verticesHex.length / 56;
        if (ci % 50 === 0 && i === 4) saved = runtime.checkpoint();
      }
      if (saved) {
        const other = meta.templates.find((r) => r.sha256 !== c.graphSha256);
        runtime.selectGraph(handles.get(other.sha256));
        runtime.kernel.math = previewMath;
        runtime.reset(789n, 0);
        // Change the derived camera cache while another graph is selected.
        const input = options.cameraCache
          ? {
              ...c.frames[0].input,
              cameraRight: [0, 0, -1],
              cameraUp: [0, 1, 0],
              viewAxis: [1, 0, 0],
            }
          : c.frames[0].input;
        runtime.frame(input);
        runtime.restore(saved);
        for (let i = 5; i < c.frames.length; i++) {
          compare(oracleFrame(c.frames[i]), c.frames[i].output, {
            case: ci,
            frame: i,
            kind: "cross-graph-checkpoint",
          });
          checkpointFrames++;
          crossGraphRestores++;
        }
        runtime.releaseCheckpoint(saved);
      }
      if (c.mode !== 0) {
        oracleReset(BigInt(`0x${c.seedHex}`), c.quality);
        for (const [i, f] of c.frames.entries()) {
          compare(oracleFrame(f), f.output, {
            case: ci,
            frame: i,
            kind: "reset",
          });
          repeatFrames++;
        }
      }
      runtime.selectGraph(handle);
      runtime.kernel.math = previewMath;
      runtime.reset(BigInt(`0x${c.seedHex}`), c.quality);
      for (const [i, f] of c.frames.entries()) {
        const actual = runtime.frame(f.input);
        derived(f);
        compare(
          actual,
          f.output,
          { case: ci, frame: i, kind: "preview-math" },
          previewMismatches,
        );
        previewFrames++;
        if (actual.geometry.verticesHex !== f.output.geometry.verticesHex) {
          const a = Buffer.from(actual.geometry.verticesHex, "hex"),
            b = Buffer.from(f.output.geometry.verticesHex, "hex");
          if (a.length !== b.length) previewGeometryLengthDifferences++;
          else
            for (let at = 0; at < a.length; at += 28)
              for (let lane = 0; lane < 3; lane++)
                previewPositionMaxAbsoluteDifference = Math.max(
                  previewPositionMaxAbsoluteDifference,
                  Math.abs(
                    a.readFloatLE(at + lane * 4) - b.readFloatLE(at + lane * 4),
                  ),
                );
        }
      }
      if ((ci + 1) % 100 === 0)
        console.log(
          JSON.stringify({
            cases: ci + 1,
            frames,
            mismatches: mismatches.length,
          }),
        );
    }
  } finally {
    runtime.close();
  }
  for (const [name, value] of Object.entries({
    graphs: meta.templates.length,
    cases: native.cases.length,
    frames,
    births,
    vertices,
    indices,
  }))
    if (native.summary[name] !== value)
      throw Error(`Incomplete prepared quad coverage: ${name}`);
  if (
    options.cameraCache &&
    cacheStates.size !== native.summary.cameraCacheStates
  )
    throw Error("Incomplete camera cache coverage");
  const sources = Object.fromEntries(
      await Promise.all(
        options.sourceFiles.map(async (name) => [
          name,
          hash(
            await Bun.file(
              new URL(`../${name}`, import.meta.url),
            ).arrayBuffer(),
          ),
        ]),
      ),
    ),
    result = {
      schema: 1,
      build: meta.build,
      protocol: meta.protocol,
      definitionSha256: hash(metaRaw),
      nativeEvidenceSha256: hash(nativeRaw),
      inspectorSha256: hash(
        await Bun.file(options.inspectorPath).arrayBuffer(),
      ),
      observerSha256: native.observerSha256,
      sources,
      ...native.summary,
      checkpointFrames,
      crossGraphRestores,
      repeatFrames,
      completeAssetByteChecks,
      cameraCacheChecks,
      mathPolicy:
        "Original game instructions with recorded native-host library results; every library name and scalar argument must match exactly. This isolates instruction/data parity and does not establish original Darwin math fidelity.",
      libraryCalls,
      previewFrames,
      previewMathMismatchCount: previewMismatches.length,
      previewMathMismatches: previewMismatches.slice(0, 15),
      previewPositionMaxAbsoluteDifference,
      previewGeometryLengthDifferences,
      originalBlocks: native.originalBlocks.length,
      executableGlobalWrites: native.executableGlobalWrites,
      rejectedEmitters: meta.rejected.length,
      actors,
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 15),
      scope: meta.scope,
    };
  await Bun.write(outputPath, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      ...result,
      sources: undefined,
      actors: undefined,
      previewMathMismatches: undefined,
      scope: undefined,
    }),
  );
  if (mismatches.length) process.exitCode = 1;
}
