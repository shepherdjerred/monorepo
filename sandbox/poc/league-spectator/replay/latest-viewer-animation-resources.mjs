import { sha256 } from "./structural-comparison.mjs";
import { createLatestAnimationPoses } from "./latest-animation-poses.mjs";
import { createLatestAnimationRigBindings } from "./latest-animation-rigs.mjs";
import { createSceneAnimationBindings } from "./scene-animation-bindings.mjs";
import { assertLatestStaticCatalogSelection } from "./latest-static-catalog.mjs";
import { sameDirectCompiledData } from "./latest-direct-compiled-restore.mjs";

const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

// This binds original static graph/rig/leaf resources. Animation controller
// state and replay-dependent provider values remain separate consumers.
export async function createLatestViewerAnimationResources({
  profile,
  sceneBytes,
  raw,
  staticCatalog = null,
  signal,
}) {
  if (!(sceneBytes instanceof Uint8Array) || typeof raw !== "function")
    throw Error("Owned scene bytes and explicit resource reader required");
  let inventory = null;
  if (staticCatalog !== null) {
    assertLatestStaticCatalogSelection(staticCatalog);
    if (!sameDirectCompiledData(profile, staticCatalog.profile()))
      throw Error("Viewer animation resource profile differs");
    inventory = staticCatalog.describe();
  }
  if (inventory?.sourceAuthorities?.animation) {
    const authorityPath = inventory.roles.sceneAnimationAuthority,
      rigPath = inventory.roles.sceneAnimationRig,
      posePath = inventory.roles.sceneAnimationLeafPoses;
    if (
      ![authorityPath, rigPath, posePath].every(
        (path) => typeof path === "string",
      )
    )
      throw Error("Complete selected scene animation roles required");
    const authorityBytes = await raw(authorityPath);
    await staticCatalog.assertRole("sceneAnimationAuthority", authorityBytes);
    const bindings = await createSceneAnimationBindings({
      baseProfileBytes: await raw("decoder-16.21-macos/profile.json"),
      imageBytes: await raw("decoder-16.21-macos/image.bin"),
      sceneBytes,
      authorityBytes,
      readResource: ({ authority, file }) =>
        raw(staticCatalog.sceneAnimationResourcePath({ authority, file })),
      signal,
    });
    const rigBytes = await raw(rigPath),
      rigs = decode(rigBytes);
    await staticCatalog.assertRole("sceneAnimationRig", rigBytes);
    return Object.freeze({
      sceneAuthoritySha256: await sha256(authorityBytes),
      poseManifestPath: posePath,
      async bind(graphFile, graphBytes, catalogBytes) {
        const bound = await bindings.bind({
          graphFile,
          graphBytes,
          catalogBytes,
        });
        if (!rigs.graphs[graphFile])
          throw Error("Selected graph omitted its original constructed rig");
        return { ...bound, rig: structuredClone(rigs.graphs[graphFile]) };
      },
      async readLeaf(bound, file) {
        return bound.readLeaf(file);
      },
    });
  }
  const clockBytes = await raw("decoder-16.21-macos/animation-clock.json"),
    poseManifestPath = "latest-animation-poses/manifest.json",
    poseBytes = await raw(poseManifestPath),
    rigBytes = await raw("decoder-16.21-macos/animation-rigs.json"),
    poseDefinition = decode(poseBytes);
  if (poseDefinition.sceneManifestSha256 !== (await sha256(sceneBytes)))
    throw Error("Legacy viewer animation scene differs");
  const poses = await createLatestAnimationPoses(
      profile,
      clockBytes,
      poseBytes,
    ),
    rigs = decode(rigBytes),
    rigFactory = await createLatestAnimationRigBindings(profile, rigBytes);
  return Object.freeze({
    sceneAuthoritySha256: null,
    poseManifestPath,
    async bind(graphFile, graphBytes, catalogBytes) {
      const rig = rigs.graphs[graphFile];
      if (!rig) throw Error("Equipped constructed rig is unprepared");
      const bound = await poses.bind(graphFile, graphBytes, catalogBytes),
        rigBindings = await rigFactory.bind(
          graphFile,
          await raw(`latest-scene/${rig.rigFile}`),
          catalogBytes,
        );
      return { ...bound, rig: structuredClone(rig), rigBindings };
    },
    async readLeaf(bound, file) {
      if (!/^clips\/\d+\.clip$/.test(file))
        throw Error("Explicit numeric viewer leaf resource required");
      const bytes = await raw(
        `latest-animation-poses/${bound.directory}/${file}`,
      );
      if ((await sha256(bytes)) !== bound.expectedFileHash(file))
        throw Error("Viewer clip hash differs");
      return bytes;
    },
  });
}
