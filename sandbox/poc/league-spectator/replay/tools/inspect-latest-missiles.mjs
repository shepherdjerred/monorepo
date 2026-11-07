// Recorded identities, static bindings and initial targets; no browser/game UI.
import { resolve } from "node:path";
import {
  analyzeLatestMissiles,
  createLatestMissileMotion,
} from "../latest-missiles.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "../latest-missile-initialization.mjs";
import { createLatestMissileFrame } from "../latest-missile-frame.mjs";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";

const [reportPath, scenePath, packagePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-latest-missiles.mjs <semantics.json> <scene-dir> <decoder-dir> <evidence.json>",
  );
const scene = resolve(scenePath),
  decoder = resolve(packagePath),
  report = await Bun.file(reportPath).json(),
  manifest = await Bun.file(`${scene}/manifest.json`).json(),
  heights = new Float32Array(
    await Bun.file(`${scene}/heights.bin`).arrayBuffer(),
  ),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  motionBytes = await Bun.file(`${decoder}/missile-motion.json`).arrayBuffer(),
  controllerBytes = await Bun.file(
    `${decoder}/missile-controllers.json`,
  ).arrayBuffer(),
  actorBytes = await Bun.file(`${decoder}/missile-actors.json`).arrayBuffer(),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  manifest.build !== report.build ||
  manifest.protocol !== report.protocol ||
  profile.clientVersion !== report.build ||
  profile.protocolDigest !== report.protocol ||
  report.fieldCodecsSha256 !== profile.fieldCodecsSha256 ||
  report.decoderImageSha256 !== profile.decoderImageSha256 ||
  report.constructorImageSha256 !== profile.constructorImageSha256 ||
  hash(motionBytes) !== profile.missileMotionSha256 ||
  hash(controllerBytes) !== profile.missileControllersSha256 ||
  hash(actorBytes) !== profile.missileActorsSha256
)
  throw Error("Missile inspection package mismatch");
const motion = JSON.parse(new TextDecoder().decode(motionBytes));
const controllerDefinition = JSON.parse(
  new TextDecoder().decode(controllerBytes),
);
const actorDefinition = JSON.parse(new TextDecoder().decode(actorBytes));
if (
  motion.decoderImageSha256 !== profile.decoderImageSha256 ||
  controllerDefinition.decoderImageSha256 !== profile.decoderImageSha256 ||
  actorDefinition.decoderImageSha256 !== profile.decoderImageSha256
)
  throw Error("Missile motion source differs from decoder");
const subjects = [];
for (const hero of report.heroes) {
  const asset =
    manifest.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`];
  if (!asset) throw Error("Unprepared hero skin for missile binding");
  subjects.push({
    entityId: hero.entityId,
    character: hero.champion,
    catalog: await Bun.file(`${scene}/${asset.spellCatalog}`).json(),
  });
}
const terrain = createLatestTerrain(manifest, heights),
  controllers = createLatestMissileControllers(controllerDefinition);
const analysis = analyzeLatestMissiles(report, subjects, motion, {
    manifest,
    terrain,
    controllers,
    initialization: createLatestMissileInitialization(controllerDefinition),
    frame: createLatestMissileFrame(
      controllerDefinition,
      createLatestMissileMotion(motion),
      controllers,
      terrain,
    ),
    actors: createLatestMissileActors(actorDefinition),
  }),
  result = {
    schema: 1,
    build: report.build,
    protocol: report.protocol,
    replaySha256: report.replaySha256,
    inputScope:
      report.scope ??
      "Original replay decoded by the browser-compatible WASM reconstruction pipeline",
    sampledNativeFields: report.status === "native-sampled-missile-fields",
    missileMotionSha256: profile.missileMotionSha256,
    missileControllersSha256: profile.missileControllersSha256,
    missileActorsSha256: profile.missileActorsSha256,
    fieldCodecsSha256: profile.fieldCodecsSha256,
    semanticsSha256: hash(await Bun.file(reportPath).arrayBuffer()),
    sceneManifestSha256: hash(
      await Bun.file(`${scene}/manifest.json`).arrayBuffer(),
    ),
    terrainSourceSha256: hash(
      await Bun.file(
        new URL("../latest-terrain.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    missileSourceSha256: hash(
      await Bun.file(
        new URL("../latest-missiles.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    controllerSourceSha256: hash(
      await Bun.file(
        new URL("../latest-missile-controllers.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    initializationSourceSha256: hash(
      await Bun.file(
        new URL("../latest-missile-initialization.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    frameSourceSha256: hash(
      await Bun.file(
        new URL("../latest-missile-frame.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    actorSourceSha256: hash(
      await Bun.file(
        new URL("../latest-missile-actors.mjs", import.meta.url),
      ).arrayBuffer(),
    ),
    ...analysis,
    scope:
      "Recorded fields, static bindings, start/packet initialization and gated owned controller-frame inputs; actor collision/phase/lifetime, actual frame schedule and A/V fidelity remain separate",
  };
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(analysis.summary));
