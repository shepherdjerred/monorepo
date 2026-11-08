import { loadLatestDirectEffectPackage } from "./latest-direct-effect-package.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import { createDirectInitializationTransfer } from "./latest-direct-initialization-ownership.mjs";
import { assertReplayRendererPolicy } from "./latest-renderer-policy.mjs";
import {
  buildLatestDirectEffectEvents,
  createLatestWorldPresentation,
} from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { createLatestEffectContexts } from "./latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "./latest-effect-resolvers.mjs";
import { createLatestUnitResources } from "./latest-unit-resources.mjs";
import { createLatestDirectEffectPlacement } from "./latest-direct-effect-placement.mjs";
import { LatestDirectEffectClient } from "./latest-direct-effect-client.mjs";
import { LatestDirectEffectPresentation } from "./latest-direct-effect-presentation.mjs";
import { LatestDirectEffectRenderer } from "./latest-direct-effect-renderer.mjs";
import { createLatestDirectNavScene } from "./latest-direct-nav-scene.mjs";
import { loadDirectNavSceneGpuProgram } from "./latest-direct-nav-scene-gpu.mjs";
import { LatestDirectNavSceneRenderer } from "./latest-direct-nav-scene-renderer.mjs";
import { DIRECT_NAV_SCENE_POLICY } from "./latest-direct-nav-scene-contract.mjs";
import { parentRenderCamera } from "./latest-parent-renderer.mjs";
import { requestTargetedMissilePresentation } from "./latest-targeted-missile-client.mjs";
import {
  loadLatestInitialResourcePrefix,
  INITIAL_RESOURCE_PREFIX_POLICY,
} from "./latest-initial-resource-prefix.mjs";
import * as THREE from "three";
import { loadLatestViewerPoseAssets } from "./latest-viewer-pose-assets.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { sameDirectCompiledData } from "./latest-direct-compiled-restore.mjs";
import {
  createLatestViewerPoseAttachmentPlacement,
  VIEWER_POSE_ATTACHMENT_POLICY,
} from "./latest-viewer-pose-attachment.mjs";

// Ordinary Play and diagnostics share this partial presentation runtime.
// Coverage, visual fidelity and browser performance acceptance remain separate.
export async function createLatestDirectEffectSession({
  world,
  report,
  scene,
  manifest,
  manifestBytes,
  sceneManifestBytes,
  gpuRenderer = null,
  navigationMode = "actual-gpu",
  pipeline,
  missilePlayback,
  presentationInputs = null,
  unitResources = null,
  viewerPoseAssets = null,
  staticCatalog = null,
  assetBase = new URL("/assets/", location.href).href,
}) {
  const sessionStarted = performance.now();
  assertReplayRendererPolicy(THREE);
  manifestBytes = ownLatestStaticBytes(manifestBytes);
  if (!["actual-gpu", "loader-only-no-gpu"].includes(navigationMode))
    throw Error("Explicit navigation submission mode required");
  sceneManifestBytes = ownLatestStaticBytes(sceneManifestBytes);
  if (staticCatalog !== null) {
    assertLatestStaticCatalogSelection(staticCatalog);
    await staticCatalog.assertRole("scene", sceneManifestBytes);
    await staticCatalog.assertRole("effects", manifestBytes);
  }
  if (
    JSON.stringify(JSON.parse(new TextDecoder().decode(sceneManifestBytes))) !==
    JSON.stringify(scene)
  )
    throw Error("Scene object differs from exact manifest bytes");
  const loaded = new Map();
  const load = (path) => {
    if (!loaded.has(path))
      loaded.set(
        path,
        (async () => {
          const response = await fetch(new URL(path, assetBase));
          if (response.status !== 200)
            throw Error(`Direct effect asset HTTP ${response.status}: ${path}`);
          return new Uint8Array(await response.arrayBuffer());
        })(),
      );
    return loaded.get(path);
  };
  if (
    presentationInputs !== null &&
    (typeof presentationInputs !== "object" ||
      Object.keys(presentationInputs).some(
        (key) =>
          !["entities", "resourceTracks", "attachmentTracks"].includes(key),
      ))
  )
    throw Error(
      "Direct session requires serializable world presentation tracks",
    );
  const worldInputs = structuredClone({
    entities: presentationInputs?.entities ?? [],
    resourceTracks: presentationInputs?.resourceTracks ?? [],
    attachmentTracks: presentationInputs?.attachmentTracks ?? [],
    missilePlayback,
    rootAttachmentPolicy: VIEWER_POSE_ATTACHMENT_POLICY,
  });
  const heights = await load("latest-scene/heights.bin");
  const heightValues = new Float32Array(
    heights.buffer,
    heights.byteOffset,
    heights.byteLength / 4,
  );
  const profile = JSON.parse(
    new TextDecoder().decode(await load("decoder-16.21-macos/profile.json")),
  );
  const packetPlacement = await createLatestDirectEffectPlacement({
    profile,
    packageBytes: await load("latest-world-descriptor-abi/package.json"),
  });
  viewerPoseAssets ??= await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load,
    THREE,
    staticCatalog,
  });
  const placementDefinitions = new Map();
  const placementPolicy = createLatestViewerPoseAttachmentPlacement({
    profile,
    packetPlacement,
    definitions: placementDefinitions,
  });
  const terrain = createLatestTerrain(scene, heightValues);
  let targetedSourcePreparationMetrics = null;
  worldInputs.targetedMissilePresentation =
    await requestTargetedMissilePresentation({
      onPreparationMetrics: (metrics) => {
        targetedSourcePreparationMetrics = metrics;
      },
      family: "all",
      includeDirectMissilePresentation: true,
      report,
      scene,
      heights: heightValues,
      world: worldInputs,
      profile,
      assetBase,
      ...(staticCatalog === null
        ? {}
        : { staticCatalogInitialization: staticCatalog.serializeForWorker() }),
    });
  worldInputs.directMissilePresentation =
    worldInputs.targetedMissilePresentation.directMissilePresentation;
  delete worldInputs.targetedMissilePresentation.directMissilePresentation;
  const initialResources = worldInputs.resourceTracks.length
    ? null
    : await loadLatestInitialResourcePrefix({
        profile,
        load,
        manifestBytes,
        report,
        staticCatalog,
      });
  if (initialResources)
    worldInputs.initialResourcePrefixPolicy = INITIAL_RESOURCE_PREFIX_POLICY;
  let resourcePolicy = unitResources;
  if (resourcePolicy === null) {
    const contexts =
      initialResources?.contexts ??
      (await createLatestEffectContexts({
        profile,
        effectsManifestBytes: manifestBytes,
        packageBytes: await load("latest-effect-contexts/package.json"),
        ...(staticCatalog === null
          ? {}
          : {
              staticCatalog,
            }),
      }));
    const resolvers =
      initialResources?.resolvers ??
      (await createLatestEffectResolvers({
        profile,
        contexts,
        builtinContextPackageBytes: await load(
          "latest-builtin-resource-contexts/package.json",
        ),
        effectsManifestBytes: manifestBytes,
        packageBytes: await load("latest-effect-resolvers/package.json"),
        staticCatalog,
      }));
    resourcePolicy = await createLatestUnitResources({
      profile,
      resolvers,
      packageBytes: await load("latest-unit-resources/package.json"),
      staticCatalog,
    });
  }
  const presentationWorld = createLatestWorldPresentation({
    ...worldInputs,
    report,
    scene,
    terrain,
    effectsManifest: manifest,
    initialResourcePrefix: initialResources?.policy ?? null,
    placementResolver: placementPolicy.resolve,
    viewerPoseAssets,
  });
  const events = buildLatestDirectEffectEvents({
    pipeline,
    report,
    missilePlayback,
    targetedMissilePresentation: worldInputs.targetedMissilePresentation,
    world: presentationWorld,
    unitResources: resourcePolicy,
  });
  const poseInitialization = viewerPoseAssets.serializeForWorker();
  const packageStarted = performance.now();
  const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes,
    staticCatalog,
    viewerPoseInitialization:
      staticCatalog === null ? null : poseInitialization,
    effectIds: events.flatMap((e) =>
      [e.definitionId, e.auxiliaryCandidateDefinitionId].filter(Boolean),
    ),
  });
  const packageElapsedMs = performance.now() - packageStarted;
  if (initialResources)
    Object.assign(prepared.packages, initialResources.packages);
  prepared.packages.effectsManifest = manifestBytes;
  prepared.packages.viewerPoseAssets = poseInitialization.value;
  let staticCatalogInitialization;
  if (staticCatalog !== null)
    staticCatalogInitialization = await staticCatalog.bindWorkerInitialization(
      poseInitialization.value.packages,
    );
  for (const [id, definition] of prepared.definitions)
    placementDefinitions.set(id, definition);
  let navigation = null;
  const navigationStarted = performance.now();
  if (
    [...prepared.definitions.values()].some((d) =>
      d.emitters.some((e) => e.navGroundProgram),
    )
  ) {
    const worldNavScene = await createLatestDirectNavScene({
      sceneManifestBytes,
      sourcePackageBytes: await load("latest-direct-nav-scene/package.json"),
      policy: DIRECT_NAV_SCENE_POLICY,
    });
    const loaderOnly = navigationMode === "loader-only-no-gpu";
    if (!loaderOnly && gpuRenderer?.isWebGLRenderer !== true)
      throw Error(
        "Actual WebGL renderer required for ordinary navigation playback",
      );
    const provider = loaderOnly
      ? null
      : new LatestDirectNavSceneRenderer({
          renderer: gpuRenderer,
          worldNavScene,
          program: await loadDirectNavSceneGpuProgram({ load }),
        });
    if (provider)
      try {
        await provider.prepare();
      } catch (error) {
        provider.dispose();
        throw error;
      }
    navigation = {
      worldNavScene,
      provider,
      gpuRenderer,
      materials: prepared.navGroundMaterials,
      loaderOnly,
    };
  }
  const navigationElapsedMs = performance.now() - navigationStarted;
  const client = new LatestDirectEffectClient();
  const presentation = new LatestDirectEffectPresentation(client);
  const renderer = new LatestDirectEffectRenderer(
    world,
    manifest,
    manifestBytes,
    {
      assetBase,
      navigation,
      staticCatalog,
      selectedMaterials: prepared.selectedMaterials ?? null,
    },
  );
  renderer.group.visible = false;
  try {
    const initializationPayload = {
      profile: prepared.profile,
      packages: prepared.packages,
      contract: { ...prepared.contract, replayHash: report.replaySha256 },
      definitions: [...prepared.definitions.values()],
      events,
      report,
      scene,
      heights: heightValues,
      world: worldInputs,
      ...(staticCatalog === null ? {} : { staticCatalogInitialization }),
    };
    const ownedInitialization = createDirectInitializationTransfer(
      initializationPayload,
      [prepared.initializationCompilationInputs, poseInitialization.ownership],
    );
    const summary = await client.initialize(initializationPayload, {
      ownedInitialization,
    });
    if (
      staticCatalog !== null &&
      !sameDirectCompiledData(
        summary.staticCatalogInventory,
        staticCatalog.describe(),
      )
    )
      throw Error("Direct worker restored a different static selection");
    const rendererStarted = performance.now();
    await renderer.loadDefinitions(prepared.definitions);
    const rendererElapsedMs = performance.now() - rendererStarted;
    const transport = summary.initializationTransport;
    summary.sessionInitialization = {
      targetedSourcePreparation: targetedSourcePreparationMetrics,
      elapsedMs: performance.now() - sessionStarted,
      packageElapsedMs,
      navigationElapsedMs,
      rendererElapsedMs,
      knownMainPreparationCpuMs:
        transport.producerPreparationCpuMs +
        transport.ticketPreparationCpuMs +
        transport.clientSynchronousPreparationMs,
      producerPreparationCpuMs: transport.producerPreparationCpuMs,
      ticketPreparationCpuMs: transport.ticketPreparationCpuMs,
      clientSynchronousPreparationMs: transport.clientSynchronousPreparationMs,
      clientInitializationElapsedMs: transport.roundTripMs,
      scope:
        "known main CPU segments include producer copies, ownership mint/claim, validation and synchronous post; elapsed intervals also include asynchronous loading/compilation and are not additive CPU measurements",
      completeMainThreadCpuMeasured: false,
      ...(staticCatalog === null
        ? {}
        : { selectedStaticInputs: staticCatalog.initializationMetrics() }),
    };
    return {
      client,
      renderer,
      summary,
      async requestPresentation(time, camera) {
        const { view } = parentRenderCamera(camera, world);
        return presentation.sample(time, view);
      },
      isPresentationCurrent(result) {
        return presentation.isCurrent(result);
      },
      claimPresentation(result, epoch) {
        return presentation.claimCurrent(result, epoch);
      },
      isPresentationClaimCurrent(ticket, epoch) {
        return presentation.isClaimCurrent(ticket, epoch);
      },
      releasePresentationClaim(ticket) {
        presentation.releaseClaim(ticket);
      },
      async sample(time, camera) {
        const { view } = parentRenderCamera(camera, world);
        const result = await presentation.sample(time, view);
        if (!presentation.isCurrent(result))
          throw new DOMException(
            "Direct effect presentation superseded",
            "AbortError",
          );
        return result.packet;
      },
      async inspect() {
        return {
          worker: await client.coverage(),
          placementPolicy: structuredClone(placementPolicy.metadata),
          viewerPosePresentation: {
            policy: viewerPoseAssets.policy,
            presentationContentHash: viewerPoseAssets.contentHash,
          },
          resourcePresentationPolicy: initialResources
            ? structuredClone(initialResources.policy.metadata)
            : null,
          renderer: renderer.submissionCoverage(),
          targetedMissilePresentation: structuredClone(
            worldInputs.targetedMissilePresentation,
          ),
          directMissilePresentation: structuredClone(
            worldInputs.directMissilePresentation,
          ),
          directMissileFamilyPresentation:
            presentationWorld.directMissileFamilyDiagnostics(),
          definitions: [...prepared.definitions.values()].map((d) => ({
            id: d.id,
            definitionHash: d.definitionHash,
            programVersion: d.programVersion,
            systemIdentity: d.systemIdentity,
            systemFlags: d.systemFlags,
            systemAudio: d.systemAudio,
            systemOmissions: d.systemOmissions,
            childSiblingProgram: structuredClone(d.childSiblingProgram ?? null),
            supported: d.emitters.map((e) => e.index),
            components: d.emitters.map((e) => ({
              id: e.index,
              primitive: e.primitive,
              materialPolicy: e.materialPolicy ?? null,
              meshRenderFlagsPolicy: e.meshRenderFlagsPolicy ?? null,
              cameraLocalOffsetProgram: structuredClone(
                e.cameraLocalOffsetProgram ?? null,
              ),
              legacyOffsetProgram: structuredClone(
                e.legacyOffsetProgram ?? null,
              ),
              rayProgram: structuredClone(e.rayProgram ?? null),
              rayMaterialSelection: structuredClone(
                e.rayMaterialSelection ?? null,
              ),
              rayPaletteTexture: structuredClone(e.rayPaletteTexture ?? null),
              meshProgram: structuredClone(e.meshProgram ?? null),
              meshMaterialSelection: structuredClone(
                e.meshMaterialSelection ?? null,
              ),
              spriteProgram: structuredClone(e.spriteProgram ?? null),
              paletteProgram: structuredClone(e.paletteProgram ?? null),
              multUvProgram: structuredClone(e.multUvProgram ?? null),
              depthBiasProgram: structuredClone(e.depthBiasProgram ?? null),
              navGroundProgram: structuredClone(e.navGroundProgram ?? null),
              paletteTexture: structuredClone(e.paletteTexture ?? null),
              omissions: [...(e.omissions ?? [])],
            })),
            unsupported: d.unsupported,
            blockers: d.blockers,
          })),
          acceptance: {
            normalPlaybackReplacementAccepted: false,
            reason:
              "coverage, native parent/world bindings, and browser performance gates are not established",
          },
        };
      },
      close() {
        presentation.close();
        client.close();
        renderer.dispose();
      },
    };
  } catch (error) {
    presentation.close();
    client.close();
    renderer.dispose();
    throw error;
  }
}
