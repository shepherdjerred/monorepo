import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { reconstructLatest } from "../latest-reconstruction.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [replayPath, packagePath, runtimePath, vendorPath, outputPath, end] =
  process.argv.slice(2);
if (!end)
  throw Error(
    "Usage: bun tools/inspect-latest-semantics.mjs <replay.rofl> <package-dir> <runtime.mjs> <fzstd.mjs> <output.json> <end-seconds>",
  );
const runtime = new Uint8Array(await Bun.file(runtimePath).arrayBuffer());
const manifest = await Bun.file(runtimePath.replace(/\.mjs$/, ".json")).json();
if ((await sha256(runtime)) !== manifest.sha256)
  throw Error("WASM runtime hash mismatch");
const { default: createUnicorn } = await import(
  pathToFileURL(resolve(runtimePath))
);
const { decompress } = await import(pathToFileURL(resolve(vendorPath)));
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
  effectPlacementBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-effect-placement/package.json"),
    ).arrayBuffer(),
  ),
  effectDescriptorBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-effect-descriptor/package.json"),
    ).arrayBuffer(),
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
  worldStateBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-world-state/package.json"),
    ).arrayBuffer(),
  ),
  worldSceneBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-scene/manifest.json"),
    ).arrayBuffer(),
  ),
  worldCatalogBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-scene/world.json"),
    ).arrayBuffer(),
  ),
  replicationBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-replication/package.json"),
    ).arrayBuffer(),
  ),
  deltaMode: "signed8",
  corpsePolicyBytes: new Uint8Array(
    await Bun.file(
      resolve(packagePath, "../latest-corpse/package.json"),
    ).arrayBuffer(),
  ),
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
