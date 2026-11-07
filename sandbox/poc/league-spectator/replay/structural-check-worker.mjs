import { compareStructural, sha256 } from "./structural-comparison.mjs";
import { reconstructLatest } from "./latest-reconstruction.mjs";
import { restoreLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";

async function load(path, binary = false) {
  const response = await fetch(path);
  if (!response.ok)
    throw Error(`Research input ${path}: HTTP ${response.status}`);
  return binary
    ? new Uint8Array(await response.arrayBuffer())
    : response.json();
}
self.onmessage = async ({ data }) => {
  try {
    if (!["run", "reconstruct"].includes(data.type))
      throw Error("Unknown research worker request");
    const root = "/assets/decoder-16.21-macos";
    const [profile, image, constructors, runtimeManifest, runtimeBytes] =
      await Promise.all([
        load(`${root}/profile.json`),
        load(`${root}/image.bin`, true),
        load(`${root}/constructors.bin`, true),
        load("/assets/vendor/unicorn_x86_candidate.json"),
        load("/assets/vendor/unicorn_x86_candidate.mjs", true),
      ]);
    if ((await sha256(runtimeBytes)) !== runtimeManifest.sha256)
      throw Error("WASM runtime integrity check failed");
    const { default: createUnicorn } =
      await import("/assets/vendor/unicorn_x86_candidate.mjs");
    if (data.type === "reconstruct") {
      const staticCatalog =
        data.staticCatalogInitialization === undefined
          ? null
          : await restoreLatestStaticCatalogSelection({
              initialization: data.staticCatalogInitialization,
              load: (path) => load(`/assets/${path}`, true),
            });
      const [
        bytes,
        fieldCodecBytes,
        startupConfigBytes,
        effectRemovalBytes,
        effectCreationBytes,
        effectPlacementBytes,
        effectDescriptorBytes,
        appearanceStackInputBytes,
        unitFormInputBytes,
        missileTargetInputBytes,
        targetVisibilityInputBytes,
        targetVisibilityMaskInputBytes,
        replicationBytes,
        championStateBytes,
        combatStatBytes,
        experienceBytes,
        inventoryBytes,
        corpsePolicyBytes,
        worldStateBytes,
        worldSceneBytes,
        worldCatalogBytes,
        vendor,
      ] = await Promise.all([
        data.buffer
          ? Promise.resolve(new Uint8Array(data.buffer))
          : load("/research-latest.rofl", true),
        load(`${root}/field-codecs.json`, true),
        load("/assets/latest-startup-config/package.json", true),
        load("/assets/latest-effect-removal/package.json", true),
        load("/assets/latest-effect-creation/package.json", true),
        load("/assets/latest-effect-placement/package.json", true),
        load("/assets/latest-effect-descriptor/package.json", true),
        load("/assets/latest-appearance-stack-inputs/package.json", true),
        load("/assets/latest-unit-form-inputs/package.json", true),
        load("/assets/latest-missile-targets/package.json", true),
        load("/assets/latest-target-visibility/package.json", true),
        load("/assets/latest-target-visibility-masks/package.json", true),
        load("/assets/latest-replication/package.json", true),
        load("/assets/latest-champion-state/package.json", true),
        load("/assets/latest-combat-stats/package.json", true),
        load("/assets/latest-experience/package.json", true),
        load("/assets/latest-inventory/package.json", true),
        load("/assets/latest-corpse/package.json", true),
        load("/assets/latest-world-state/package.json", true),
        load("/assets/latest-scene/manifest.json", true),
        load("/assets/latest-scene/world.json", true),
        import("/assets/vendor/fzstd.mjs"),
      ]);
      const report = await reconstructLatest({
        buffer: bytes.buffer,
        decompress: vendor.decompress,
        uc: await createUnicorn(),
        profile,
        image,
        constructors,
        fieldCodecBytes,
        startupConfigBytes,
        effectRemovalBytes,
        effectCreationBytes,
        effectPlacementBytes,
        effectDescriptorBytes,
        appearanceStackInputBytes,
        unitFormInputBytes,
        missileTargetInputBytes,
        targetVisibilityInputBytes,
        targetVisibilityMaskInputBytes,
        replicationBytes,
        championStateBytes,
        combatStatBytes,
        experienceBytes,
        inventoryBytes,
        corpsePolicyBytes,
        worldStateBytes,
        worldSceneBytes,
        worldCatalogBytes,
        staticCatalog,
        endTime: data.endTime ?? 120,
        deltaMode: "signed8",
      });
      self.postMessage({ type: "reconstruction", report });
      return;
    }
    const [samples, oracle] = await Promise.all([
      load(`${root}/samples.json`),
      load(`${root}/oracle.json`),
    ]);
    self.postMessage({
      type: "ready",
      total: Object.keys(samples.packets).length,
    });
    const report = await compareStructural({
      uc: await createUnicorn(),
      profile,
      image,
      constructors,
      samples,
      oracle,
      onResult: (result) => self.postMessage({ type: "packet", result }),
    });
    self.postMessage({ type: "complete", report });
  } catch (error) {
    self.postMessage({ type: "error", error: String(error) });
  }
};
