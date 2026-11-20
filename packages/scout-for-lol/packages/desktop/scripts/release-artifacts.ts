// Where `release:package:<channel>` leaves each platform's signed outputs, and
// how `release:publish:<channel>` finds them again.
//
//   Windows  dist/<channel>/<Product>_<version>_x64-setup.exe and its .sig,
//            exactly as `cargo packager` names them.
//   macOS    dist/<channel>/macos/ holds the update archive and its .sig plus
//            the disk image, already under their published names.
//
// Each host packages its own platform, so a directory may hold either, both
// (after copying one host's outputs to the other), or neither.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ScoutDesktopUpdateChannel,
  ScoutDesktopUpdatePlatform,
} from "../../data/src/scout-client/desktop-update-manifest.schema.ts";
import {
  macDiskImageFileName,
  updateArtifactFileName,
} from "../../data/src/scout-client/desktop-update-release.ts";

/** The directory macOS packaging writes into; a dry run never writes here. */
export function macOutputDirectory(
  root: string,
  channel: ScoutDesktopUpdateChannel,
): string {
  return join(root, "dist", channel, "macos");
}

/** Where an unsigned macOS dry run writes, so publication never sees it. */
export function macDryRunDirectory(
  root: string,
  channel: ScoutDesktopUpdateChannel,
): string {
  return join(root, "dist", channel, "macos-dry-run");
}

export type LocalArtifact = {
  platform: ScoutDesktopUpdatePlatform;
  /** Name it is published under, inside `releases/<version>/`. */
  fileName: string;
  body: Uint8Array;
  /** Base64 minisign signature, as `cargo packager` writes it. */
  signature: string;
  /** Other immutable files published beside it (the macOS disk image). */
  companions: { fileName: string; body: Uint8Array; contentType: string }[];
};

const exists = (names: string[], name: string) => names.includes(name);

async function listing(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readSignature(path: string): Promise<string> {
  return (await readFile(path, "utf8")).trim();
}

async function windowsArtifact(
  root: string,
  channel: ScoutDesktopUpdateChannel,
  version: string,
): Promise<LocalArtifact | null> {
  const directory = join(root, "dist", channel);
  const suffix = `_${version}_x64-setup.exe`;
  const names = await listing(directory);
  const matches = names.filter((name) => name.endsWith(suffix));
  if (matches.length === 0) return null;
  const [name, ...others] = matches;
  if (name === undefined || others.length > 0) {
    throw new Error(
      `Expected one *${suffix} in ${directory}, found ${matches.join(", ")}`,
    );
  }
  if (!exists(names, `${name}.sig`)) {
    throw new Error(
      `${name} has no .sig; package it with release:package:${channel} so it is signed`,
    );
  }
  return {
    platform: "windows-x86_64",
    fileName: updateArtifactFileName(channel, version, "windows-x86_64"),
    body: new Uint8Array(await readFile(join(directory, name))),
    signature: await readSignature(join(directory, `${name}.sig`)),
    companions: [],
  };
}

async function macArtifact(
  root: string,
  channel: ScoutDesktopUpdateChannel,
  version: string,
): Promise<LocalArtifact | null> {
  const directory = macOutputDirectory(root, channel);
  const names = await listing(directory);
  const archive = updateArtifactFileName(channel, version, "darwin-universal");
  const diskImage = macDiskImageFileName(channel, version);
  const present = [archive, `${archive}.sig`, diskImage].filter((name) =>
    exists(names, name),
  );
  if (present.length === 0) return null;
  if (present.length < 3) {
    throw new Error(
      `${directory} has only ${present.join(", ")}; a macOS release needs ${archive}, its .sig and ${diskImage}. Package it again with release:package:${channel}`,
    );
  }
  return {
    platform: "darwin-universal",
    fileName: archive,
    body: new Uint8Array(await readFile(join(directory, archive))),
    signature: await readSignature(join(directory, `${archive}.sig`)),
    companions: [
      {
        fileName: diskImage,
        body: new Uint8Array(await readFile(join(directory, diskImage))),
        contentType: "application/x-apple-diskimage",
      },
    ],
  };
}

/**
 * Every platform's signed outputs for `version` in this checkout's `dist/`.
 * A platform with no outputs is skipped; one with partial outputs is an error.
 */
export async function readLocalArtifacts(
  root: string,
  channel: ScoutDesktopUpdateChannel,
  version: string,
): Promise<LocalArtifact[]> {
  const found = [
    await windowsArtifact(root, channel, version),
    await macArtifact(root, channel, version),
  ].filter((artifact) => artifact !== null);
  if (found.length === 0) {
    throw new Error(
      `No signed ${channel} ${version} outputs in dist/${channel}/; run release:package:${channel} on the Windows or macOS host`,
    );
  }
  return found;
}

/** The content type an update artifact is uploaded with. */
export function artifactContentType(
  platform: ScoutDesktopUpdatePlatform,
): string {
  switch (platform) {
    case "windows-x86_64":
      return "application/vnd.microsoft.portable-executable";
    case "darwin-universal":
      return "application/gzip";
  }
}
