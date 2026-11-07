import { sha256 } from "./structural-comparison.mjs";
import { createLatestAnimationClock } from "./latest-animation-clock.mjs";
import { validateAnimationPoseTimeDomain } from "./latest-animation-pose-time-domain.mjs";

// Static, complete resource-frame coverage for the existing Toolkit pose
// evaluator. This does not establish native pose interpolation or blending.
export async function createLatestAnimationPoses(
  profile,
  clockBytes,
  poseBytes,
) {
  const clocks = await createLatestAnimationClock(profile, clockBytes);
  if ((await sha256(poseBytes)) !== profile.animationPosesSha256)
    throw Error("Animation pose package hash mismatch");
  const manifest = JSON.parse(new TextDecoder().decode(poseBytes)),
    clock = JSON.parse(new TextDecoder().decode(clockBytes));
  if (
    manifest.schema !== 1 ||
    manifest.build !== profile.clientVersion ||
    manifest.protocol !== profile.protocolDigest ||
    manifest.animationClockSha256 !== profile.animationClockSha256 ||
    manifest.sceneManifestSha256 !== clock.sceneManifestSha256 ||
    manifest.toolchain.leagueToolkitRevision !==
      "76bf57bf4fd195343dec610bf0f912a06b910914" ||
    manifest.toolchain.sdkVersion !== "10.0.303" ||
    Object.keys(manifest.graphs).sort().join("\n") !==
      Object.keys(clock.graphs).sort().join("\n")
  )
    throw Error("Unsupported animation pose package");
  return {
    async bind(graphFile, graphBytes, catalogBytes) {
      const boundClock = await clocks.bind(graphFile, graphBytes, catalogBytes),
        source = manifest.graphs[graphFile],
        expected = clock.graphs[graphFile],
        oldCatalog = JSON.parse(new TextDecoder().decode(catalogBytes));
      if (
        !source ||
        source.graphSha256 !== expected.graphSha256 ||
        source.sourceCatalogSha256 !== expected.catalogSha256 ||
        source.directory !== graphFile.slice(0, graphFile.lastIndexOf("/")) ||
        JSON.stringify(source.catalog.joints) !==
          JSON.stringify(oldCatalog.joints) ||
        Object.keys(source.catalog.clips).sort().join("\n") !==
          Object.keys(expected.clips).sort().join("\n")
      )
        throw Error("Animation pose graph contract mismatch");
      const files = new Map();
      for (const [name, clip] of Object.entries(source.catalog.clips)) {
        const reference = expected.clips[name];
        if (
          !reference ||
          reference.status !== "prepared" ||
          !/^clips\/\d+\.clip$/.test(clip.file) ||
          !/^[a-f0-9]{64}$/.test(clip.sha256) ||
          clip.frames !== reference.clock.resourceFrames ||
          clip.sourceSha256 !== reference.source.sha256 ||
          clip.fps !== reference.exportedFps ||
          clip.duration !== reference.exportedDuration ||
          (files.has(clip.file) && files.get(clip.file) !== clip.sha256)
        )
          throw Error("Animation pose source/frame mismatch");
        validateAnimationPoseTimeDomain(reference, clip);
        files.set(clip.file, clip.sha256);
      }
      return {
        clock: boundClock,
        catalog: structuredClone(source.catalog),
        directory: source.directory,
        expectedFileHash(file) {
          if (!files.has(file)) throw Error("Unprepared animation pose file");
          return files.get(file);
        },
      };
    },
  };
}
