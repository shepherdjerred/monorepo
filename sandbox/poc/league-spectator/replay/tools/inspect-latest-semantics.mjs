import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reconstructLatest } from "../latest-reconstruction.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [
  replayPath,
  packagePath,
  runtimePath,
  vendorPath,
  outputPath,
  end,
  mapCache,
] = process.argv.slice(2);
if (!end)
  throw Error(
    "Usage: bun tools/inspect-latest-semantics.mjs <replay.rofl> <package-dir> <runtime.mjs> <fzstd.mjs> <output.json> <end-seconds> [exact-map-cache]",
  );
const runtime = new Uint8Array(await Bun.file(runtimePath).arrayBuffer());
const manifest = await Bun.file(runtimePath.replace(/\.mjs$/, ".json")).json();
if ((await sha256(runtime)) !== manifest.sha256)
  throw Error("WASM runtime hash mismatch");
const { default: createUnicorn } = await import(
  pathToFileURL(resolve(runtimePath))
);
const { decompress } = await import(pathToFileURL(resolve(vendorPath)));
// Build-wide decoder programs remain read-only in their approved package.
// Map-specific packages are independently produced against the exact scene;
// their runtime readers still enforce pinned hashes and native source blocks.
const mapBytes = async (relative) =>
  new Uint8Array(
    await Bun.file(
      mapCache
        ? resolve(mapCache, "public", relative)
        : resolve(packagePath, "..", relative),
    ).arrayBuffer(),
  );
const report = await reconstructLatest({
  buffer: await Bun.file(replayPath).arrayBuffer(),
  decompress,
  uc: await createUnicorn(),
  profile: await Bun.file(resolve(packagePath, "profile.json")).json(),
  image: new Uint8Array(
    await Bun.file(resolve(packagePath, "image.bin")).arrayBuffer(),
  ),
  constructors: new Uint8Array(
    await Bun.file(resolve(packagePath, "constructors.bin")).arrayBuffer(),
  ),
  fieldCodecBytes: new Uint8Array(
    await Bun.file(resolve(packagePath, "field-codecs.json")).arrayBuffer(),
  ),
  startupConfigBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-startup-config/package.json"),
    ).arrayBuffer(),
  ),
  effectRemovalBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-effect-removal/package.json"),
    ).arrayBuffer(),
  ),
  effectCreationBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-effect-creation/package.json"),
    ).arrayBuffer(),
  ),
  effectPlacementBytes: await mapBytes("latest-effect-placement/package.json"),
  effectDescriptorBytes: await mapBytes(
    "latest-effect-descriptor/package.json",
  ),
  appearanceStackInputBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-appearance-stack-inputs/package.json"),
    ).arrayBuffer(),
  ),
  unitFormInputBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-unit-form-inputs/package.json"),
    ).arrayBuffer(),
  ),
  endTime: Number(end),
  targetVisibilityInputBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-target-visibility/package.json"),
    ).arrayBuffer(),
  ),
  targetVisibilityMaskInputBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-target-visibility-masks/package.json"),
    ).arrayBuffer(),
  ),
  missileTargetInputBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-missile-targets/package.json"),
    ).arrayBuffer(),
  ),
  championStateBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-champion-state/package.json"),
    ).arrayBuffer(),
  ),
  experienceBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-experience/package.json"),
    ).arrayBuffer(),
  ),
  combatStatBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-combat-stats/package.json"),
    ).arrayBuffer(),
  ),
  inventoryBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-inventory/package.json"),
    ).arrayBuffer(),
  ),
  worldStateBytes: await mapBytes("latest-world-state/package.json"),
  worldSceneBytes: await mapBytes("latest-scene/manifest.json"),
  worldCatalogBytes: await mapBytes("latest-scene/world.json"),
  neutralCreationBytes:
    mapCache &&
    (
      await Bun.file(
        resolve(mapCache, "public/latest-scene/manifest.json"),
      ).json()
    ).map.id === 11
      ? await mapBytes("latest-neutral-creation/package.json")
      : null,
  replicationBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-replication/package.json"),
    ).arrayBuffer(),
  ),
  deltaMode: "signed8",
  corpsePolicyBytes: await mapBytes("latest-corpse/package.json"),
});
await Bun.write(outputPath, JSON.stringify(report));
console.log(
  JSON.stringify({
    status: report.status,
    ...report.summary,
    endTime: report.endTime,
    coordinateSpace: report.coordinateSpace,
    movementOrigin: report.movementOrigin,
    decodedPackets: report.decodedPackets,
    unhandledTypes: Object.keys(report.unhandledOpcodes).length,
  }),
);
