// Explicit multi-root counterpart of prepare-selected-static-catalog.mjs.
// The legacy single-root command and its format remain unchanged.
import { resolve, join, posix } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  STATIC_CATALOG_POLICY,
  loadLatestStaticCatalogSelection,
} from "../latest-static-catalog.mjs";
import { assertSelectedStaticSourceAuthorities } from "../latest-static-source-authorities.mjs";
import { publishSelectedStaticSources } from "./selected-static-sources.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { assertSceneAnimationAuthorityIdentity } from "../scene-animation-authority.mjs";

const [configurationPath, outputCache] = process.argv.slice(2);
if (!configurationPath || !outputCache || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-selected-scene-catalog.mjs <private-source-configuration.json> <output-cache>",
  );
const configuration = await Bun.file(resolve(configurationPath)).json();
if (
  !configuration ||
  Object.keys(configuration).sort().join("|") !== "plan|roles|roots"
)
  throw Error("Explicit {plan,roots,roles} catalog configuration required");
const { plan, roots, roles } = configuration;
const encode = (value) =>
  new TextEncoder().encode(JSON.stringify(value, null, 2));
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const publication = await publishSelectedStaticSources({
  plan,
  roots,
  outputCache: resolve(outputCache),
});
const staged = (file) => Bun.file(join(publication.publicRoot, file)).bytes();
const profilePath = "decoder-16.21-macos/profile.json";
const profileBytes = await staged(profilePath),
  profile = decode(profileBytes);
const sceneBytes = await staged(roles.scene),
  scene = decode(sceneBytes);
if (!plan.sources.animation)
  throw Error("Explicit selected scene animation authority required");
const authority = assertSceneAnimationAuthorityIdentity(
  decode(await staged(roles.sceneAnimationAuthority)),
  {
    build: profile.clientVersion,
    protocol: profile.protocolDigest,
    baseProfileSha256: await sha256(profileBytes),
    imageSha256: await sha256(await staged("decoder-16.21-macos/image.bin")),
    sceneManifestSha256: await sha256(sceneBytes),
  },
);
const animationRoles = {
  clock: "sceneAnimationClock",
  rig: "sceneAnimationRig",
  eventInventory: "sceneAnimationEventInventory",
  leafPoses: "sceneAnimationLeafPoses",
};
const sourceFile = (name, file) =>
  posix.join(posix.dirname(plan.sources[name].identity.file), file);
function exactDeclaredSource(name, file, expected) {
  const matches = Object.entries(plan.files).filter(
    ([, entry]) =>
      entry.source.authority === name && entry.source.file === file,
  );
  if (
    !matches.length ||
    matches.some(
      ([, entry]) =>
        entry.sha256 !== expected.sha256 || entry.bytes !== expected.bytes,
    )
  )
    throw Error(
      "Animation dependency absent from explicit source plan: " +
        name +
        ":" +
        file,
    );
  return matches;
}
for (const [name, role] of Object.entries(authority.roles)) {
  const declared = exactDeclaredSource(
    "animation",
    sourceFile("animation", role.file),
    role,
  );
  if (!declared.some(([target]) => target === roles[animationRoles[name]]))
    throw Error("Selected animation role differs from authority role: " + name);
  for (const dependency of role.dependsOn) {
    const name =
      dependency.authority === "native"
        ? "build"
        : dependency.authority === "derived"
          ? "animation"
          : "scene";
    exactDeclaredSource(name, sourceFile(name, dependency.file), dependency);
  }
}
const files = Object.fromEntries(
  Object.entries(plan.files).filter(([file]) => file !== profilePath),
);
const catalog = {
  schema: 2,
  kind: "prepared-selected-static-content",
  policy: STATIC_CATALOG_POLICY,
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  decoderImageSha256: profile.decoderImageSha256,
  map: { id: scene.map.id, presentationVariant: scene.map.variant },
  roles,
  files,
  sourceAuthorities: plan.sources,
};
assertSelectedStaticSourceAuthorities(catalog, await sha256(profileBytes));
const catalogPath = "latest-static-catalog/catalog.json",
  catalogBytes = encode(catalog);
const bootstrap = {
  schema: 1,
  kind: "trusted-static-content-bootstrap",
  profile: { path: profilePath, sha256: await sha256(profileBytes) },
  catalog: { path: catalogPath, sha256: await sha256(catalogBytes) },
};
const bootstrapBytes = encode(bootstrap);
// Validate the complete closure before publishing the bootstrap capability.
const load = (file) =>
  file === catalogPath
    ? catalogBytes
    : file === "latest-static-catalog/bootstrap.json"
      ? bootstrapBytes
      : staged(file);
const selected = await loadLatestStaticCatalogSelection({ load });
const contexts = await createLatestEffectContexts({
  profile,
  packageBytes: await selected.readRole("effectContexts"),
  effectsManifestBytes: await selected.readRole("effects"),
  staticCatalog: selected,
});
await Bun.write(join(publication.publicRoot, catalogPath), catalogBytes);
await Bun.write(
  join(publication.publicRoot, "latest-static-catalog/bootstrap.json"),
  bootstrapBytes,
);
console.log(
  JSON.stringify({
    publicRoot: publication.publicRoot,
    catalogSha256: bootstrap.catalog.sha256,
    files: Object.keys(files).length,
    contexts: contexts.metadata.contexts.length,
    nativeSpectatorAdmitted: false,
  }),
);
