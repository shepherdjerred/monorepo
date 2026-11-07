import { restoreLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { restoreLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { loadLatestInitialResourcePrefix } from "../latest-initial-resource-prefix.mjs";
import { createLatestUnitResources } from "../latest-unit-resources.mjs";
self.onmessage = async ({ data }) => {
  try {
    const { initialization, bundle, profile, report, scene } = data;
    const expectedRootAliases = {
      "latest-static-catalog/bootstrap.json": initialization.bootstrapBytes,
      "decoder-16.21-macos/profile.json": initialization.profileBytes,
      [initialization.inventory.catalogPath]: initialization.catalogBytes,
      ...initialization.roots,
    };
    for (const [path, bytes] of Object.entries(expectedRootAliases))
      if (bytes.buffer !== bundle.packages[path]?.buffer)
        throw Error("Catalog root did not reuse owned producer span: " + path);
    const image = bundle.packages["decoder-16.21-macos/image.bin"],
      uniqueImageSpans = new Set(
        Object.values(bundle.packages)
          .filter((bytes) => bytes.buffer === image.buffer)
          .map((bytes) => bytes.buffer),
      ).size;
    const load = (path) => {
      if (!Object.hasOwn(bundle.packages, path))
        throw Error("Captured worker static file missing: " + path);
      return bundle.packages[path];
    };
    const selected = await restoreLatestStaticCatalogSelection({
      initialization,
      load,
    });
    const poses = await restoreLatestViewerPoseAssets({
      bundle,
      profile,
      report,
      scene,
      staticCatalog: selected,
    });
    const resources = await loadLatestInitialResourcePrefix({
      profile,
      report,
      load,
      manifestBytes: await selected.readRole("effects"),
      staticCatalog: selected,
    });
    const unit = await createLatestUnitResources({
      profile,
      resolvers: resources.resolvers,
      packageBytes: await selected.readRole("unitResources"),
      staticCatalog: selected,
    });
    self.postMessage({
      ok: true,
      inventory: selected.describe(),
      contentHash: poses.contentHash,
      resourceQueries: report.heroes.flatMap((hero) =>
        [0, 69, 99].map((time) => resources.policy.query(hero.entityId, time)),
      ),
      resourceCounts: {
        contexts: resources.contexts.metadata.contexts.length,
        resolvers: resources.resolvers.metadata.actors.length,
        unitAlgorithm: unit.metadata.kind,
      },
      selectedStaticInputs: selected.initializationMetrics(),
      transferEvidence: {
        catalogRootAliases: Object.keys(expectedRootAliases).length,
        nativeImageBytes: image.length,
        uniqueImageSpans,
        nativeImageRootDuplicates: Object.values(expectedRootAliases).filter(
          (bytes) => bytes.buffer === image.buffer,
        ).length,
      },
      actors: report.heroes.map((hero) => ({
        entityId: hero.entityId,
        actor: poses.actor(hero.entityId),
      })),
      scope: {
        actualModuleWorker: true,
        emulatedInstructions: 0,
        browserExecuted: false,
        renderedCoverageEstablished: false,
      },
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: { name: error.name, message: error.message },
    });
  }
};
