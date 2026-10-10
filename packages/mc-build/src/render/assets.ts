import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import { installAssetFiles } from "./asset-cache.ts";

/**
 * Block models and textures come from Mojang's client jar, fetched on first
 * use through piston-meta and sha1-verified. They are cached under
 * ~/.cache/toolkit/mc/assets/<version> and never committed to the repo.
 */
export const ASSETS_VERSION = "26.2";
const MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const EXTRACT = [
  "assets/minecraft/blockstates/",
  "assets/minecraft/models/block/",
  "assets/minecraft/textures/block/",
  "assets/minecraft/textures/colormap/",
];

const ManifestSchema = z.object({
  versions: z.array(
    z.object({ id: z.string(), url: z.string(), sha1: z.string() }),
  ),
});
const VersionSchema = z.object({
  downloads: z.object({
    client: z.object({ url: z.string(), sha1: z.string(), size: z.number() }),
  }),
});

export function assetsCacheDir(version = ASSETS_VERSION): string {
  return path.join(os.homedir(), ".cache", "toolkit", "mc", "assets", version);
}

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

async function download(
  url: string,
  expectedSha1: string,
): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status.toString()}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha1(bytes);
  if (actual !== expectedSha1) {
    throw new Error(`${url} has sha1 ${actual}, expected ${expectedSha1}`);
  }
  return bytes;
}

/**
 * Returns the directory containing `assets/minecraft/…` for `version`,
 * downloading and extracting the client jar if it is not cached yet.
 */
export async function ensureAssets(
  version = ASSETS_VERSION,
  log?: (message: string) => void,
): Promise<string> {
  const root = assetsCacheDir(version);
  const marker = path.join(root, ".complete");
  if (await Bun.file(marker).exists()) {
    return root;
  }
  log?.(
    `fetching Minecraft ${version} client assets from Mojang (first render only)…`,
  );
  const manifestResponse = await fetch(MANIFEST_URL);
  if (!manifestResponse.ok) {
    throw new Error(
      `GET ${MANIFEST_URL} failed: HTTP ${manifestResponse.status.toString()}`,
    );
  }
  const manifest = ManifestSchema.parse(await manifestResponse.json());
  const entry = manifest.versions.find((candidate) => candidate.id === version);
  if (entry === undefined) {
    throw new Error(`Minecraft ${version} is not in Mojang's version manifest`);
  }
  const versionJson = VersionSchema.parse(
    JSON.parse(new TextDecoder().decode(await download(entry.url, entry.sha1))),
  );
  const client = versionJson.downloads.client;
  const jar = await download(client.url, client.sha1);
  const files = unzipSync(jar, {
    filter: (file) => EXTRACT.some((prefix) => file.name.startsWith(prefix)),
  });
  await installAssetFiles(root, files, client.sha1);
  log?.(
    `cached ${Object.keys(files).length.toString()} asset files in ${root}`,
  );
  return root;
}
