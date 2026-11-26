import path from "node:path";
import {
  ensureAssets,
  readAssetManifest,
} from "@shepherdjerred/mc-harness/sandbox/fetched-assets.ts";

const packageRoot = path.resolve(import.meta.dirname, "../../..");

/** The checkout's repository-owned TheStorm data folder. */
export const ownedContent = path.join(
  packageRoot,
  "server/owned/plugins/TheStorm",
);

/**
 * Names every baked `nav.rwfnav` by SHA-256. The meshes are not in Git: they
 * live in the asset bucket under that hash and are fetched into the checkout.
 */
export const navManifestFile = path.join(ownedContent, "rwf/nav-manifest.json");

/** The Gradle task behind `bun run maps:fetch-nav`, run from the package root. */
const fetchNavCommand = [
  "mise",
  "exec",
  "--",
  "gradle",
  "-p",
  "plugin",
  ":rwfmap:fetchRwfNavs",
  "--console=plain",
] as const;

/**
 * Makes the checkout's nav meshes present and exact before anything copies or
 * serves them. Call it with the content folder about to be read: a private copy
 * made from an ensured checkout needs nothing more.
 */
export async function ensureNavMeshes(
  content: string = ownedContent,
): Promise<void> {
  if (path.resolve(content) !== ownedContent) return;
  await ensureAssets({
    manifest: navManifestFile,
    fetch: fetchNavCommand,
    cwd: packageRoot,
  });
}

/** The SHA-256 the manifest records for one map's mesh. */
export async function navSha256(mapId: string): Promise<string> {
  const manifest = await readAssetManifest(navManifestFile);
  const entry = manifest.objects.find(
    (object) => object.path === `maps/${mapId}/nav.rwfnav`,
  );
  if (entry === undefined)
    throw new Error(`nav-manifest.json has no mesh for map ${mapId}`);
  return entry.sha256;
}
