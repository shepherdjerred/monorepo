/**
 * `bun run maps:publish-nav`: stores every baked `nav.rwfnav` that
 * `rwf/nav-manifest.json` names in the public asset bucket under its own
 * SHA-256, then reads each one back over the public URL. Run it after a bake
 * and before committing the manifest: CI, the image build and every other
 * checkout fetch these objects by hash and fail when one is not served.
 *
 * Objects are immutable. One that is already served with the right bytes is
 * left alone, and a key holding other bytes is a collision that stops the run.
 */
import path from "node:path";
import { awsStore } from "@shepherdjerred/mc-harness/capture/suite/aws-store.ts";
import {
  fileSha256,
  readAssetManifest,
  type AssetManifest,
} from "@shepherdjerred/mc-harness/sandbox/fetched-assets.ts";
import { navManifestFile } from "#maps/nav/meshes.ts";

/** Served at public.sjer.red (packages/homelab-cdktn/src/stacks/seaweedfs.ts). */
const bucket = "public-sjer-red";
const keyPrefix = "the-storm/nav/sha256";
const publicBase = `https://public.sjer.red/${keyPrefix}`;

type NavObject = AssetManifest["objects"][number];

/**
 * An object's name. It keeps the mesh's extension because the public site
 * redirects any path without one to a directory and never serves it.
 */
function objectName(object: NavObject): string {
  return `${object.sha256}${path.extname(object.path)}`;
}

/** Whether the public URL serves exactly the object's bytes. A 404 is "not yet". */
async function served(object: NavObject): Promise<boolean> {
  const url = `${publicBase}/${objectName(object)}`;
  const response = await fetch(url, { redirect: "manual" });
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  if (response.status !== 200 || response.body === null)
    throw new Error(`${url} returned HTTP ${response.status.toString()}`);
  const hasher = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  for await (const chunk of response.body) {
    hasher.update(chunk);
    bytes += chunk.byteLength;
  }
  const sha256 = hasher.digest("hex");
  if (bytes !== object.bytes || sha256 !== object.sha256)
    throw new Error(
      `${url} serves ${bytes.toString()} bytes hashing to ${sha256}, not ${object.path}`,
    );
  return true;
}

const manifest = await readAssetManifest(navManifestFile);
if (manifest.baseUrl !== publicBase)
  throw new Error(
    `nav-manifest.json names ${manifest.baseUrl}; this tool publishes to ${publicBase}`,
  );
const root = path.dirname(navManifestFile);
for (const object of manifest.objects) {
  const file = path.join(root, object.path);
  const handle = Bun.file(file);
  if (
    !(await handle.exists()) ||
    handle.size !== object.bytes ||
    (await fileSha256(file)) !== object.sha256
  )
    throw new Error(
      `${file} does not hold the bytes nav-manifest.json records. Bake it (gradle bakeRwfMaps) or fetch the published meshes (bun run maps:fetch-nav) first.`,
    );
}

const store = awsStore(bucket);
let uploaded = 0;
let bytes = 0;
for (const object of manifest.objects) {
  if (!(await served(object))) {
    await store.write(
      `${keyPrefix}/${objectName(object)}`,
      await Bun.file(path.join(root, object.path)).bytes(),
    );
    if (!(await served(object)))
      throw new Error(
        `${publicBase}/${objectName(object)} is not served after its upload`,
      );
    uploaded += 1;
    console.warn(`Published ${object.path} as ${objectName(object)}`);
  }
  bytes += object.bytes;
}
console.warn(
  `Verified ${manifest.objects.length.toString()} nav meshes (${bytes.toString()} bytes) at ${publicBase}: ${uploaded.toString()} uploaded now, ${(manifest.objects.length - uploaded).toString()} already served.`,
);
