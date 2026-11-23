// Tool-only file I/O around the actual spectator preparation factory. Returns
// live kernels/world/events; never serializes compiled closures or supplies poses.
import { resolve, join, dirname, sep } from "node:path";
import { realpath, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { originalCheckpointCacheSource } from "./checkpoint-cache-control-source.mjs";
import { checkpointCacheRuntimeControl } from "./checkpoint-cache-browser-control.mjs";

export async function prepareDirectReplayFromFiles({
  publicRoot,
  reportPath,
  threeModule,
  outputDirectory,
  selectionMode,
  baselineDirectory = null,
  onPreparation = null,
}) {
  if (!["catalog", "legacy"].includes(selectionMode))
    throw Error("Explicit catalog or legacy resource authority required");
  const root = await realpath(resolve(publicRoot)),
    output = resolve(outputDirectory),
    source = resolve(import.meta.dir, ".."),
    vendor = resolve(threeModule),
    inputs = {};
  async function raw(file) {
    const bytes = await Bun.file(file).bytes(),
      digest = sha(bytes),
      key = resolve(file);
    if (inputs[key] && inputs[key] !== digest)
      throw Error(`Replay preparation input drift: ${key}`);
    inputs[key] = digest;
    return bytes;
  }
  async function load(file) {
    if (
      !/^[-A-Za-z0-9_./]+$/.test(file) ||
      file.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw Error("Relative declared preparation resource path required");
    const candidate = await realpath(join(root, file));
    if (!candidate.startsWith(root + sep))
      throw Error("Preparation asset escaped selected public root");
    return raw(candidate);
  }
  const exports = [
    [
      "latest-direct-effect-session.mjs",
      ["prepareLatestDirectEffectSessionInputs"],
    ],
    [
      "latest-targeted-missile-worker.mjs",
      ["prepareTargetedMissilePresentation"],
    ],
    ["latest-static-catalog.mjs", ["loadLatestStaticCatalogSelection"]],
    ["latest-selected-materials.mjs", ["loadLatestSelectedMaterialRegistry"]],
    ["latest-effect-contexts.mjs", ["createLatestEffectContexts"]],
    ["latest-effect-resolvers.mjs", ["createLatestEffectResolvers"]],
    ["latest-effect-pipeline.mjs", ["createLatestEffectPipeline"]],
    ["latest-terrain.mjs", ["createLatestTerrain"]],
    [
      "latest-missiles.mjs",
      ["analyzeLatestMissiles", "createLatestMissileMotion"],
    ],
    ["latest-effects.mjs", ["bindLatestMissileEffects"]],
    ["latest-missile-controllers.mjs", ["createLatestMissileControllers"]],
    [
      "latest-missile-initialization.mjs",
      ["createLatestMissileInitialization"],
    ],
    ["latest-missile-actors.mjs", ["createLatestMissileActors"]],
    ["latest-missile-frame.mjs", ["createLatestMissileFrame"]],
    ["latest-missile-playback.mjs", ["buildLatestMissilePlayback"]],
    [
      "latest-direct-initialization-ownership.mjs",
      ["consumeDirectInitializationTransfer"],
    ],
    [
      "latest-direct-compiled-restore.mjs",
      ["sameDirectCompiledData", "restoreLatestDirectCompiledDefinitions"],
    ],
    ["latest-direct-effect-runtime.mjs", ["LatestDirectEffectRuntime"]],
    ["latest-direct-effect-renderer.mjs", ["LatestDirectEffectRenderer"]],
    ["latest-direct-event-ownership.mjs", ["ownDirectWorkerEventInput"]],
  ];
  await captureDirectSourceInputs(
    [import.meta.path, ...exports.map(([file]) => join(source, file))],
    raw,
  );
  await raw(vendor);
  await raw(join(dirname(vendor), "three.core.js"));
  const runtimeFile = join(source, "latest-direct-effect-runtime.mjs"),
    runtimeSource = new TextDecoder().decode(await raw(runtimeFile)),
    baselineRuntimeSource = originalCheckpointCacheSource(runtimeSource);
  const absoluteImports = (text) =>
    text.replace(
      /from "(\.[^"\r\n]+)"/g,
      (_match, file) =>
        `from ${JSON.stringify(resolve(source, file).replaceAll("\\", "/"))}`,
    );
  let baseline = null;
  if (baselineDirectory) {
    const directory = resolve(baselineDirectory),
      manifest = JSON.parse(
        new TextDecoder().decode(await raw(join(directory, "manifest.json"))),
      ),
      bytes = await raw(join(directory, "preparation-baseline.mjs"));
    if (
      manifest.kind !== "exact-pre-extraction-session-preparation" ||
      sha(bytes) !== manifest.baselineSha256 ||
      sha(await raw(join(directory, "original-session.mjs"))) !==
        manifest.sourceSha256
    )
      throw Error("Exact preparation baseline source required");
    baseline = new TextDecoder().decode(bytes);
    const replace = (before, after) => {
      if (
        !baseline.includes(before) ||
        baseline.indexOf(before) !== baseline.lastIndexOf(before)
      )
        throw Error("Unique historical preparation I/O boundary required");
      baseline = baseline.replace(before, after);
    };
    replace(
      "  onPreparation = null,\n})",
      "  onPreparation = null,\n  inputLoad,\n  targetedPreparation,\n})",
    );
    replace(
      "await requestTargetedMissilePresentation({",
      "await targetedPreparation({",
    );
    const before =
      "          const response = await fetch(new URL(path, assetBase));\n          if (response.status !== 200)\n            throw Error(`Direct effect asset HTTP ${response.status}: ${path}`);\n          return new Uint8Array(await response.arrayBuffer());";
    replace(before, "          return inputLoad(path);");
    // Bun's virtual source namespace does not inherit the physical importer's
    // resolution base. Rewrite only authored relative static import specifiers.
    baseline = baseline.replace(
      /from "(\.[^"\r\n]+)"/g,
      (_match, file) =>
        `from ${JSON.stringify(resolve(source, file).replaceAll("\\", "/"))}`,
    );
  }
  const built = await Bun.build({
    entrypoints: ["direct-preparation-entry"],
    target: "bun",
    write: false,
    external: ["/assets/*"],
    plugins: [
      {
        name: "exact-live-preparation",
        setup(build) {
          build.onResolve({ filter: /^direct-preparation-entry$/ }, () => ({
            path: "entry",
            namespace: "live-direct-preparation",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "live-direct-preparation" },
            () => ({
              loader: "js",
              resolveDir: source,
              contents:
                exports
                  .map(
                    ([file, names]) =>
                      `export {${names.join(",")}} from ${JSON.stringify(join(source, file).replaceAll("\\", "/"))};`,
                  )
                  .join("\n") +
                "\nexport {LatestDirectEffectRuntime as Candidate} from " +
                JSON.stringify(runtimeFile.replaceAll("\\", "/")) +
                ';\nexport {LatestDirectEffectRuntime as Baseline} from "baseline-cache-runtime";' +
                (baseline
                  ? '\nexport {prepareOriginalDirectSessionInputs} from "original-preparation-baseline";'
                  : ""),
            }),
          );
          build.onLoad(
            { filter: /latest-direct-effect-runtime\.mjs$/ },
            () => ({
              loader: "js",
              resolveDir: source,
              contents: checkpointCacheRuntimeControl(runtimeSource),
            }),
          );
          build.onResolve({ filter: /^baseline-cache-runtime$/ }, () => ({
            path: "baseline-runtime",
            namespace: "baseline-cache-runtime",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "baseline-cache-runtime" },
            () => ({
              loader: "js",
              contents: absoluteImports(
                checkpointCacheRuntimeControl(baselineRuntimeSource),
              ),
            }),
          );
          build.onResolve(
            { filter: /^original-preparation-baseline$/ },
            () => ({ path: "baseline", namespace: "old-direct-preparation" }),
          );
          build.onLoad(
            { filter: /.*/, namespace: "old-direct-preparation" },
            () => ({ loader: "js", resolveDir: source, contents: baseline }),
          );
          build.onResolve({ filter: /^three$/ }, () => ({ path: vendor }));
        },
      },
    ],
  });
  if (!built.success || built.outputs.length !== 1)
    throw new AggregateError(
      built.logs,
      "Live direct preparation bundle failed",
    );
  await mkdir(output, { recursive: true });
  const bundleFile = join(output, "live-preparation.bundle.mjs");
  if (await Bun.file(bundleFile).exists())
    throw Error("Fresh direct preparation output required");
  await Bun.write(bundleFile, built.outputs[0]);
  await raw(bundleFile);
  const api = await import(pathToFileURL(bundleFile).href),
    decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
    selection =
      selectionMode === "catalog"
        ? await api.loadLatestStaticCatalogSelection({ load })
        : null,
    profile = selection
      ? selection.profile()
      : decode(await load("decoder-16.21-macos/profile.json")),
    sceneManifestBytes = selection
      ? await selection.readRole("scene")
      : await load("latest-scene/manifest.json"),
    scene = decode(sceneManifestBytes),
    manifestBytes = selection
      ? await selection.readRole("effects")
      : await load("latest-effects/manifest.json"),
    manifest = decode(manifestBytes);
  const reportFile = resolve(reportPath),
    reportHasher = new Bun.CryptoHasher("sha256");
  for await (const bytes of Bun.file(reportFile).stream())
    reportHasher.update(bytes);
  inputs[reportFile] = reportHasher.digest("hex");
  const report = await Bun.file(reportFile).json(),
    materials = selection
      ? await api.loadLatestSelectedMaterialRegistry({
          staticCatalog: selection,
          load,
          perspective: "all",
        })
      : null,
    contexts = await api.createLatestEffectContexts({
      profile,
      packageBytes: await (selection
        ? selection.readRole("effectContexts")
        : load("latest-effect-contexts/package.json")),
      effectsManifestBytes: manifestBytes,
      ...(selection ? { staticCatalog: selection } : {}),
    }),
    resolvers = await api.createLatestEffectResolvers({
      profile,
      contexts,
      packageBytes: await (selection
        ? selection.readRole("effectResolvers")
        : load("latest-effect-resolvers/package.json")),
      builtinContextPackageBytes: await (selection
        ? selection.readRole("builtinResourceContexts")
        : load("latest-builtin-resource-contexts/package.json")),
      effectsManifestBytes: manifestBytes,
      ...(selection ? { staticCatalog: selection } : {}),
    }),
    pipeline = resolvers.bindTimeline(
      await api.createLatestEffectPipeline({
        report,
        effectsManifestBytes: manifestBytes,
        quadGpuBytes: materials
          ? materials.packageBytes("quad")
          : await load("latest-complete-quad-gpu/package.json"),
        trailGpuBytes: materials
          ? materials.packageBytes("trail")
          : await load("latest-trail-particles/gpu.json"),
        selectedMaterials: materials,
      }),
      report,
    );
  const subjects = await Promise.all(
    report.heroes.map(async (hero) => {
      const asset =
        scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
      if (!asset) throw Error("Actual replay source appearance missing");
      return {
        entityId: hero.entityId,
        character: hero.champion,
        catalog: decode(await load(`latest-scene/${asset.spellCatalog}`)),
      };
    }),
  );
  const numeric = {};
  for (const [name, key] of [
    ["motion", "missileMotionSha256"],
    ["controllers", "missileControllersSha256"],
    ["actors", "missileActorsSha256"],
  ]) {
    const bytes = await load(`decoder-16.21-macos/missile-${name}.json`);
    if (sha(bytes) !== profile[key])
      throw Error("Actual missile numeric source differs");
    numeric[name] = decode(bytes);
  }
  const heights = await load("latest-scene/heights.bin"),
    terrain = api.createLatestTerrain(
      scene,
      new Float32Array(
        heights.buffer,
        heights.byteOffset,
        heights.byteLength / 4,
      ),
    ),
    controllers = api.createLatestMissileControllers(numeric.controllers),
    initialization = api.createLatestMissileInitialization(numeric.controllers),
    actors = api.createLatestMissileActors(numeric.actors),
    frame = api.createLatestMissileFrame(
      numeric.controllers,
      api.createLatestMissileMotion(numeric.motion),
      controllers,
      terrain,
    ),
    analysis = api.analyzeLatestMissiles(report, subjects, numeric.motion, {
      manifest: scene,
      terrain,
      controllers,
      initialization,
      frame,
      actors,
    }),
    missilePlayback = api.buildLatestMissilePlayback(
      analysis,
      api.bindLatestMissileEffects(report, manifest),
      frame,
      actors,
      report.endTime,
    );
  const options = {
    report,
    scene,
    manifest,
    manifestBytes,
    sceneManifestBytes,
    pipeline,
    missilePlayback,
    staticCatalog: selection,
    assetBase: pathToFileURL(root + sep).href,
    inputLoad: load,
    onPreparation,
    targetedPreparation: async (payload) =>
      api.prepareTargetedMissilePresentation(
        payload,
        load,
        payload.onPreparationMetrics,
        payload.onPreparation,
      ),
  };
  const live = await api.prepareLatestDirectEffectSessionInputs(options);
  const runtimeInputs = {
    ...live.prepared.contract,
    replayHash: report.replaySha256,
    definitions: live.prepared.definitions,
    events: live.events,
    world: live.presentationWorld,
    kernels: live.prepared.kernels,
  };
  return {
    api,
    live,
    runtimeInputs,
    report,
    scene,
    manifest,
    staticCatalog: selection,
    options,
    inputs,
    runtimePair: {
      Baseline: api.Baseline,
      Candidate: api.Candidate,
      ownEvents: api.ownDirectWorkerEventInput,
      originalSourceSha256: sha(new TextEncoder().encode(runtimeSource)),
      baselineSourceSha256: sha(
        new TextEncoder().encode(baselineRuntimeSource),
      ),
    },
    prepareBaseline: baseline
      ? () => api.prepareOriginalDirectSessionInputs(options)
      : null,
    async assertInputsUnchanged() {
      for (const [file, digest] of Object.entries(inputs)) {
        const hasher = new Bun.CryptoHasher("sha256");
        for await (const bytes of Bun.file(file).stream()) hasher.update(bytes);
        if (hasher.digest("hex") !== digest)
          throw Error(`Direct preparation source/input drift: ${file}`);
      }
    },
  };
}
