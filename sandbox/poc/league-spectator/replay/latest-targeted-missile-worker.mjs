import { createTargetedMissilePresentation } from "./latest-targeted-missile-context.mjs";
import { createFixedTimePresentation } from "./latest-fixed-time-context.mjs";
import { createMissilePresentationFamilies } from "./latest-missile-presentation-context.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { loadLatestDirectMissilePresentation } from "./latest-direct-missile-presentation.mjs";
import { restoreLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import {
  assertSelectedResourceRoot,
  assertSelectedResourceDependency,
} from "./latest-selected-resource-programs.mjs";
import { loadLatestViewerPoseAssets } from "./latest-viewer-pose-assets.mjs";
import { loadLatestInitialResourcePrefix } from "./latest-initial-resource-prefix.mjs";
import { collectNamedBoneTypeOneCasterRecords } from "./latest-missile-caster-context.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { sha256 } from "./structural-comparison.mjs";

export async function prepareTargetedMissilePresentation(
  payload,
  inputLoad,
  observePreparation = null,
) {
  const files = new Map(),
    readSizes = new Map();
  const load = (path) => {
    if (!files.has(path))
      files.set(
        path,
        Promise.resolve(inputLoad(path)).then((bytes) => {
          if (!(bytes instanceof Uint8Array))
            throw Error("Targeted static bytes required");
          readSizes.set(path, bytes.byteLength);
          return bytes;
        }),
      );
    return files.get(path);
  };
  const staticCatalog =
    payload.staticCatalogInitialization === undefined
      ? null
      : await restoreLatestStaticCatalogSelection({
          initialization: payload.staticCatalogInitialization,
          load,
        });
  if (staticCatalog !== null) {
    await assertSelectedResourceRoot({
      selection: staticCatalog,
      profile: payload.profile,
    });
    await assertSelectedResourceDependency(
      staticCatalog,
      "scene",
      payload.scene,
    );
  }
  if (
    payload.includeDirectMissilePresentation !== undefined &&
    typeof payload.includeDirectMissilePresentation !== "boolean"
  )
    throw Error("Explicit direct missile preparation option required");
  if (
    payload.family !== undefined &&
    !["fixed-speed", "fixed-time", "all"].includes(payload.family)
  )
    throw Error("Explicit verified missile presentation family required");
  const terrain = createLatestTerrain(payload.scene, payload.heights);
  const preparationStarted = performance.now(),
    priorPaths = new Set(readSizes.keys()),
    decode = (bytes) =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const subjects = await Promise.all(
    payload.report.heroes.map(async (hero) => {
      const asset =
        payload.scene.champions[
          `${hero.champion.toLowerCase()}/${hero.skinId}`
        ];
      if (!asset) throw Error("Targeted source appearance missing");
      return {
        entityId: hero.entityId,
        character: hero.champion,
        catalog: decode(await load(`latest-scene/${asset.spellCatalog}`)),
      };
    }),
  );
  const controllerBytes = await load(
    "decoder-16.21-macos/missile-controllers.json",
  );
  if (
    (await sha256(controllerBytes)) !== payload.profile.missileControllersSha256
  )
    throw Error("Targeted source defaults differ");
  const namedRecords = collectNamedBoneTypeOneCasterRecords({
    report: payload.report,
    subjects,
    initialization: createLatestMissileInitialization(decode(controllerBytes)),
  });
  const scanElapsedMs = performance.now() - preparationStarted;
  const sourceInputs = {};
  if (namedRecords.length && payload.family !== "fixed-time") {
    if (!payload.world?.resourceTracks?.length) {
      const initial = await loadLatestInitialResourcePrefix({
        profile: payload.profile,
        report: payload.report,
        manifestBytes: await load("latest-effects/manifest.json"),
        load,
        staticCatalog,
      });
      sourceInputs.initialResourcePrefix = initial.policy;
    }
    sourceInputs.viewerPoseAssets = await loadLatestViewerPoseAssets({
      profile: payload.profile,
      report: payload.report,
      scene: payload.scene,
      load,
      staticCatalog,
    });
  }
  if (observePreparation !== null) {
    if (typeof observePreparation !== "function")
      throw Error("Targeted preparation observer must be a function");
    const added = [...readSizes].filter(([path]) => !priorPaths.has(path));
    observePreparation({
      candidateRecords: namedRecords.length,
      namedPoseAssetsLoaded: !!sourceInputs.viewerPoseAssets,
      scanElapsedMs,
      elapsedMs: performance.now() - preparationStarted,
      uniqueStaticInputFiles: added.length,
      uniqueStaticInputBytes: added.reduce((n, [, bytes]) => n + bytes, 0),
      scope:
        "worker initialization-only source scan and conditional owned pose/resource loading; elapsed includes asynchronous loading, not per-frame work",
    });
  }
  const world = createLatestWorldPresentation({
    ...payload.world,
    ...sourceInputs,
    report: payload.report,
    scene: payload.scene,
    terrain,
  });
  const prepare =
    payload.family === "all"
      ? createMissilePresentationFamilies
      : payload.family === "fixed-time"
        ? createFixedTimePresentation
        : createTargetedMissilePresentation;
  const result = await prepare({
    report: payload.report,
    scene: payload.scene,
    terrain,
    world,
    profile: payload.profile,
    load,
    endTime: payload.report.endTime,
  });
  if (staticCatalog !== null)
    result.staticCatalogInventory = staticCatalog.describe();
  if (payload.includeDirectMissilePresentation)
    result.directMissilePresentation =
      await loadLatestDirectMissilePresentation({
        profile: payload.profile,
        report: payload.report,
        scene: payload.scene,
        terrain,
        load,
        manifest: JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await load("latest-effects/manifest.json"),
          ),
        ),
      });
  return result;
}

if (
  typeof self !== "undefined" &&
  typeof self.postMessage === "function" &&
  typeof document === "undefined" &&
  globalThis.Bun?.isMainThread !== true
) {
  self.onmessage = async ({ data }) => {
    try {
      if (
        data?.version !== 1 ||
        data.type !== "prepare" ||
        !Number.isSafeInteger(data.id) ||
        data.id < 1
      )
        throw Error("Owned targeted worker preparation request required");
      const payload = data.payload;
      let preparationMetrics;
      const result = await prepareTargetedMissilePresentation(
        payload,
        async (path) => {
          if (payload.staticAssets !== undefined) {
            if (!(payload.staticAssets[path] instanceof Uint8Array))
              throw Error(`Targeted supplied static asset missing: ${path}`);
            return payload.staticAssets[path];
          }
          const response = await fetch(new URL(path, payload.assetBase));
          if (response.status !== 200)
            throw Error(
              `Targeted static asset HTTP ${response.status}: ${path}`,
            );
          return new Uint8Array(await response.arrayBuffer());
        },
        (metrics) => {
          preparationMetrics = metrics;
        },
      );
      self.postMessage({
        version: 1,
        id: data.id,
        ok: true,
        result,
        preparationMetrics,
      });
    } catch (error) {
      self.postMessage({
        version: 1,
        id: data?.id,
        ok: false,
        error: { name: error.name, message: error.message },
      });
    }
  };
}
