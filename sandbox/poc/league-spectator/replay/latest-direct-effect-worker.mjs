import {
  LatestDirectEffectRuntime,
  directDrawTransfers,
} from "./latest-direct-effect-runtime.mjs";
import { createLatestVfxValues } from "./latest-vfx-values.mjs";
import { createLatestVfxBirth } from "./latest-vfx-birth.mjs";
import { createLatestVfxEmission } from "./latest-vfx-emission.mjs";
import { createLatestVfxSamplers } from "./latest-vfx-samplers.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { createLatestDirectEffectPlacement } from "./latest-direct-effect-placement.mjs";
import {
  createLatestViewerRootAttachmentPlacement,
  VIEWER_ROOT_ATTACHMENT_POLICY,
} from "./latest-viewer-root-attachment.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  restoreLatestDirectCompiledDefinitions,
  directInitializationBufferStats,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import {
  loadLatestInitialResourcePrefix,
  INITIAL_RESOURCE_PREFIX_POLICY,
  INITIAL_RESOURCE_STATIC_PACKAGES,
} from "./latest-initial-resource-prefix.mjs";
import { restoreLatestViewerPoseAssets } from "./latest-viewer-pose-assets.mjs";
import { restoreLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import {
  createLatestViewerPoseAttachmentPlacement,
  VIEWER_POSE_ATTACHMENT_POLICY,
} from "./latest-viewer-pose-attachment.mjs";

export async function createDirectEffectKernels({ profile, packages }) {
  if (
    profile.clientVersion !== "16.21.829.8620" ||
    profile.protocolDigest !== "20e09df23c66b85e"
  )
    throw Error("Incompatible direct kernel build/protocol");
  const parsed = {};
  for (const [name, key] of [
    ["values", "vfxValuesSha256"],
    ["birth", "vfxBirthSha256"],
    ["emission", "vfxEmissionSha256"],
    ["samplers", "vfxSamplersSha256"],
  ]) {
    const bytes = packages[name];
    if ((await sha256(bytes)) !== profile[key])
      throw Error(`Direct ${name} kernel package hash differs`);
    parsed[name] = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (parsed[name].decoderImageSha256 !== profile.decoderImageSha256)
      throw Error("Direct kernel image contract differs");
  }
  const values = createLatestVfxValues(parsed.values);
  return {
    values,
    birth: createLatestVfxBirth(parsed.birth, values),
    emission: createLatestVfxEmission(parsed.emission, values),
    samplers: createLatestVfxSamplers(parsed.samplers),
  };
}

// Exported handler is also exercised by CLI tests; importing this module in Bun
// does not initialize workers, fetch assets or load an emulator.
export function createDirectEffectWorkerHandler() {
  let runtime = null;
  return async ({ type, payload }) => {
    if (type === "initialize") {
      if (runtime) throw Error("Direct effect worker already initialized");
      const accountingStarted = performance.now(),
        buffers = directInitializationBufferStats(payload),
        initializationAccounting = {
          ...buffers,
          workerAccountingMs: performance.now() - accountingStarted,
        };
      // The selected catalog owns both pose and compilation leaves. Shared paths
      // must agree byte-for-byte before restoring either capability.
      const selectedInputs = new Map(
        Object.entries(payload.packages.viewerPoseAssets?.packages ?? {}),
      );
      if (payload.staticCatalogInitialization !== undefined) {
        if (!Array.isArray(payload.packages.compilationInputs))
          throw Error("Captured selected compiler inputs required");
        for (const entry of payload.packages.compilationInputs) {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== "string" ||
            !(entry[1] instanceof Uint8Array)
          )
            throw Error("Captured selected compiler input malformed");
          const prior = selectedInputs.get(entry[0]);
          if (prior !== undefined && !sameDirectCompiledData(prior, entry[1]))
            throw Error(
              "Selected pose/compiler input bytes differ: " + entry[0],
            );
          selectedInputs.set(entry[0], entry[1]);
        }
      }
      const staticCatalog =
        payload.staticCatalogInitialization === undefined
          ? null
          : await restoreLatestStaticCatalogSelection({
              initialization: payload.staticCatalogInitialization,
              load: async (path) => {
                const bytes = selectedInputs.get(path);
                if (!(bytes instanceof Uint8Array))
                  throw Error(
                    "Missing captured selected worker input: " + path,
                  );
                return bytes;
              },
            });
      if (staticCatalog !== null) {
        await staticCatalog.assertRole(
          "effects",
          payload.packages.effectsManifest,
        );
        if (!sameDirectCompiledData(staticCatalog.profile(), payload.profile))
          throw Error("Worker profile differs from captured static selection");
      }
      const restored = await restoreLatestDirectCompiledDefinitions(payload, {
        staticCatalog,
      });
      const kernels = restored.kernels;
      if (
        payload.packages.placement === undefined &&
        payload.events.some((event) => event.descriptor)
      )
        throw Error(
          "Descriptor events require the static packet-placement policy",
        );
      const packetPlacement =
        payload.packages.placement === undefined
          ? null
          : await createLatestDirectEffectPlacement({
              profile: payload.profile,
              packageBytes: payload.packages.placement,
            });
      const definitions = restored.definitions;
      if (
        payload.world?.rootAttachmentPolicy !== undefined &&
        ![
          VIEWER_ROOT_ATTACHMENT_POLICY,
          VIEWER_POSE_ATTACHMENT_POLICY,
        ].includes(payload.world.rootAttachmentPolicy)
      )
        throw Error("Unsupported explicit root attachment presentation policy");
      const placementPolicy =
        payload.world?.rootAttachmentPolicy === VIEWER_POSE_ATTACHMENT_POLICY
          ? createLatestViewerPoseAttachmentPlacement({
              profile: payload.profile,
              packetPlacement,
              definitions,
            })
          : payload.world?.rootAttachmentPolicy ===
              VIEWER_ROOT_ATTACHMENT_POLICY
            ? createLatestViewerRootAttachmentPlacement({
                profile: payload.profile,
                packetPlacement,
                definitions,
              })
            : packetPlacement;
      const terrain = createLatestTerrain(payload.scene, payload.heights);
      const viewerPoseAssets =
        payload.world?.rootAttachmentPolicy === VIEWER_POSE_ATTACHMENT_POLICY
          ? await restoreLatestViewerPoseAssets({
              bundle: payload.packages.viewerPoseAssets,
              profile: payload.profile,
              report: payload.report,
              scene: payload.scene,
              staticCatalog,
            })
          : null;
      if (
        payload.world?.initialResourcePrefixPolicy !== undefined &&
        payload.world.initialResourcePrefixPolicy !==
          INITIAL_RESOURCE_PREFIX_POLICY
      )
        throw Error(
          "Unsupported explicit initial resource presentation policy",
        );
      const initialResources =
        payload.world?.initialResourcePrefixPolicy ===
        INITIAL_RESOURCE_PREFIX_POLICY
          ? await loadLatestInitialResourcePrefix({
              profile: payload.profile,
              report: payload.report,
              manifestBytes: payload.packages.effectsManifest,
              staticCatalog,
              load: async (path) => {
                const key = Object.entries(
                  INITIAL_RESOURCE_STATIC_PACKAGES,
                ).find(([, value]) => value === path)?.[0];
                if (!key || !(payload.packages[key] instanceof Uint8Array))
                  throw Error(
                    "Initial resource presentation requires pinned static package bytes",
                  );
                return payload.packages[key];
              },
            })
          : null;
      if (
        payload.world?.directMissilePresentation &&
        (!(payload.packages.effectsManifest instanceof Uint8Array) ||
          (await sha256(payload.packages.effectsManifest)) !==
            payload.contract.contentHash)
      )
        throw Error(
          "Direct missile presentation requires the compiled static manifest bytes",
        );
      const world = createLatestWorldPresentation({
        ...payload.world,
        report: payload.report,
        scene: payload.scene,
        terrain,
        effectsManifest: payload.world?.directMissilePresentation
          ? JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                payload.packages.effectsManifest,
              ),
            )
          : null,
        initialResourcePrefix: initialResources?.policy ?? null,
        placementResolver: placementPolicy?.resolve ?? null,
        viewerPoseAssets,
      });
      runtime = new LatestDirectEffectRuntime({
        ...payload.contract,
        definitions,
        events: payload.events,
        world,
        kernels,
      });
      return {
        contract: runtime.contract,
        events: payload.events.length,
        definitions: payload.definitions.length,
        emulatedInstructions: 0,
        compiledDefinitionValidation: restored.metrics,
        initializationAccounting,
        ...(staticCatalog === null
          ? {}
          : {
              staticCatalogInventory: staticCatalog.describe(),
              selectedStaticInputs: staticCatalog.initializationMetrics(),
            }),
        placementPolicy: placementPolicy?.metadata ?? null,
        viewerPosePresentation: viewerPoseAssets
          ? {
              policy: viewerPoseAssets.policy,
              presentationContentHash: viewerPoseAssets.contentHash,
            }
          : null,
        resourcePresentationPolicy: initialResources?.policy.metadata ?? null,
        directMissileFamilyPresentation: world.directMissileFamilyDiagnostics(),
        directMissilePresentation: payload.world?.directMissilePresentation
          ? {
              policy: payload.world.directMissilePresentation.policy,
              traces: payload.world.directMissilePresentation.traces.length,
              nativeAcceptance: null,
              exactLegacyParticleTimelineAgreement: false,
            }
          : null,
      };
    }
    if (!runtime) throw Error("Direct effect worker is not initialized");
    if (type === "advance" || type === "camera") {
      const startedAt = performance.now();
      const beforeSteps = runtime.metrics.simulationSteps;
      if (type === "advance") runtime.advanceTo(payload.time);
      const packet = runtime.generateDraws(payload.camera);
      const simulationMs = type === "camera" ? 0 : packet.metrics.simulationMs;
      const workerOperationMs = performance.now() - startedAt;
      packet.metrics = {
        ...packet.metrics,
        simulationMs,
        worldQueryMs: type === "camera" ? 0 : packet.metrics.worldQueryMs,
        worldQueries: type === "camera" ? 0 : packet.metrics.worldQueries,
        workerOperationMs,
        simulationStepsAdvanced: runtime.metrics.simulationSteps - beforeSteps,
        bookkeepingMs: Math.max(
          0,
          workerOperationMs - simulationMs - packet.metrics.geometryMs,
        ),
      };
      return packet;
    }
    if (type === "checkpoint") return runtime.checkpoint();
    if (type === "restore") {
      runtime.restore(payload);
      return { time: runtime.time };
    }
    if (type === "coverage") return runtime.coverage({ includeRows: true });
    throw Error(`Unknown direct effect worker request: ${type}`);
  };
}

if (
  typeof self !== "undefined" &&
  typeof self.postMessage === "function" &&
  typeof document === "undefined" &&
  globalThis.Bun?.isMainThread !== true
) {
  const handle = createDirectEffectWorkerHandler();
  let queue = Promise.resolve();
  self.onmessage = ({ data }) => {
    const receivedAtEpochMs = performance.timeOrigin + performance.now();
    queue = queue.then(async () => {
      try {
        if (data?.version !== 1 || !Number.isSafeInteger(data.id))
          throw Error("Malformed direct worker request");
        const processingAtEpochMs = performance.timeOrigin + performance.now();
        const result = await handle(data);
        const transfers = result.draws ? directDrawTransfers(result) : [];
        if (result.draws) {
          result.metrics = {
            ...result.metrics,
            transport: {
              receivedAtEpochMs,
              processingAtEpochMs,
              replyReadyAtEpochMs: performance.timeOrigin + performance.now(),
              drawBufferBytes: transfers.reduce(
                (sum, buffer) => sum + buffer.byteLength,
                0,
              ),
            },
          };
        }
        self.postMessage(
          { version: 1, id: data.id, ok: true, result },
          transfers,
        );
      } catch (error) {
        self.postMessage({
          version: 1,
          id: data.id,
          ok: false,
          error: { name: error.name, message: error.message },
        });
      }
    });
  };
}
