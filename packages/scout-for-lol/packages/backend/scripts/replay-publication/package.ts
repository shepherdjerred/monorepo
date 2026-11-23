import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  ReplayRenderPackageManifestSchema,
  type ReplayRenderPackageManifest,
} from "@scout-for-lol/domain/artifacts/replay-support.ts";
import { normalizeGameBuild } from "@scout-for-lol/domain/artifacts/replay-transport.mjs";
import { restoreStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";

const MANIFEST = "manifest.json";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

export type ReplayPublicationObject = {
  key: string;
  path: string;
  bytes: number;
  sha256: string;
  contentType: string;
};

async function restoredFile(directory: string, name: string) {
  const filename = path.join(directory, name);
  const stats = await lstat(filename);
  if (!stats.isFile() || (await realpath(filename)) !== filename) {
    throw new Error(`Expected an exact regular replay archive file: ${name}`);
  }
  return {
    filename,
    size: stats.size,
    file: Bun.file(path.toNamespacedPath(filename)),
  };
}

export async function readReplayPackageManifest(directory: string) {
  const { filename, size } = await restoredFile(directory, MANIFEST);
  if (size > MAX_MANIFEST_BYTES)
    throw new Error("Replay manifest exceeds 16 MiB");
  const bytes = await readFile(filename);
  if (bytes.byteLength !== size)
    throw new Error("Replay manifest length changed while reading the archive");
  const manifest = ReplayRenderPackageManifestSchema.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    ),
  );
  return { filename, bytes, manifest };
}

async function verifiedMember(
  directory: string,
  prefix: string,
  member: ReplayRenderPackageManifest["files"][number],
): Promise<ReplayPublicationObject> {
  const { filename, size, file } = await restoredFile(directory, member.path);
  if (size !== member.bytes)
    throw new Error(
      `Replay archive file length differs from manifest: ${member.path}`,
    );
  const hasher = new Bun.CryptoHasher("sha256");
  let bytes = 0;
  for await (const chunk of file.stream()) {
    bytes += chunk.byteLength;
    if (bytes > member.bytes) break;
    hasher.update(chunk);
  }
  if (bytes !== member.bytes || hasher.digest("hex") !== member.sha256)
    throw new Error(
      `Replay archive file bytes differ from manifest: ${member.path}`,
    );
  return {
    key: `${prefix}/${member.path}`,
    path: filename,
    bytes,
    sha256: member.sha256,
    contentType: file.type,
  };
}

/** Prepare a closed, digest-bound object list in caller-owned scratch. */
export async function prepareReplayPublication(input: {
  archivePath: string;
  archiveDigest: string;
  directory: string;
}): Promise<{
  gameBuild: string;
  protocol: string;
  manifestSha256: string;
  objects: ReplayPublicationObject[];
}> {
  const archivePath = path.resolve(input.archivePath);
  const archiveStats = await lstat(archivePath);
  if (!archiveStats.isFile())
    throw new Error("Replay publication archive must be a regular file");
  const destination = path.resolve(input.directory);
  const restored = await restoreStaticArchive(
    archivePath,
    destination,
    input.archiveDigest,
  );
  if (!restored.includes(MANIFEST))
    throw new Error("Replay publication archive has no root manifest.json");

  const directory = await realpath(destination);
  const {
    filename,
    bytes: manifestBytes,
    manifest,
  } = await readReplayPackageManifest(directory);
  if (!Bun.file(manifest.entrypoint).type.startsWith("text/javascript"))
    throw new Error("Replay engine entrypoint must be a JavaScript module");
  const gameBuild = normalizeGameBuild(manifest.gameBuild);
  if (gameBuild === null || gameBuild !== manifest.gameBuild)
    throw new Error("Replay manifest must name a canonical game build");
  const manifestSha256 = new Bun.CryptoHasher("sha256")
    .update(manifestBytes)
    .digest("hex");
  const prefix = `replay-assets/${gameBuild}/${manifestSha256}`;

  const inventory = new Set(manifest.files.map((file) => file.path));
  if (
    restored.length !== inventory.size + 1 ||
    restored.some((name) => name !== MANIFEST && !inventory.has(name))
  )
    throw new Error(
      "Replay archive files do not match the exact manifest inventory",
    );

  const objects: ReplayPublicationObject[] = [];
  for (const member of manifest.files) {
    objects.push(await verifiedMember(directory, prefix, member));
  }
  objects.push({
    key: `${prefix}/${MANIFEST}`,
    path: filename,
    bytes: manifestBytes.byteLength,
    sha256: manifestSha256,
    contentType: "application/json",
  });
  return { gameBuild, protocol: manifest.protocol, manifestSha256, objects };
}
