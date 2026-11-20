import { isDeepStrictEqual } from "node:util";
import {
  SCOUT_DESKTOP_UPDATE_ORIGIN,
  SCOUT_DESKTOP_UPDATE_SCHEMA,
  SCOUT_DESKTOP_UPDATE_SCHEMA_MINOR,
  ScoutDesktopUpdateManifestSchema,
  ScoutDesktopUpdatePlatformSchema,
  compareScoutDesktopVersions,
  type ScoutDesktopUpdateArtifact,
  type ScoutDesktopUpdateChannel,
  type ScoutDesktopUpdateManifest,
  type ScoutDesktopUpdatePlatform,
} from "./desktop-update-manifest.schema.ts";

/**
 * Pure release-publication rules for the desktop update channel. The
 * operator-run script in `packages/desktop/scripts/publish-release.ts` does the
 * I/O; everything it must get right lives here so it is tested without a
 * bucket.
 */

/** Object key of a channel manifest in the release bucket. */
export function channelManifestKey(channel: ScoutDesktopUpdateChannel): string {
  return `${channel}.json`;
}

/** Object key of one immutable release file. */
export function releaseObjectKey(version: string, fileName: string): string {
  return `releases/${version}/${fileName}`;
}

/** The public URL of a bucket object. */
export function publicUrl(key: string): string {
  return `${SCOUT_DESKTOP_UPDATE_ORIGIN}/${key}`;
}

/**
 * The name a platform's update artifact is published under, inside
 * `releases/<version>/`. Windows ships the NSIS installer itself; macOS ships
 * a gzipped tar of the notarized `.app` bundle.
 */
export function updateArtifactFileName(
  channel: ScoutDesktopUpdateChannel,
  version: string,
  platform: ScoutDesktopUpdatePlatform,
): string {
  switch (platform) {
    case "windows-x86_64":
      return `scout-desktop-${channel}_${version}_x64-setup.exe`;
    case "darwin-universal":
      return `scout-desktop-${channel}_${version}_universal.app.tar.gz`;
  }
}

/**
 * The name the macOS disk image is published under. It is what a person
 * downloads to install the first time; installed builds update from the
 * app archive instead, so the disk image is not in the manifest.
 */
export function macDiskImageFileName(
  channel: ScoutDesktopUpdateChannel,
  version: string,
): string {
  return `scout-desktop-${channel}_${version}_universal.dmg`;
}

export type PublishedArtifact = Omit<ScoutDesktopUpdateArtifact, "url"> & {
  /** Name the artifact is uploaded under, inside `releases/<version>/`. */
  fileName: string;
};

export type BuildManifestInput = {
  channel: ScoutDesktopUpdateChannel;
  version: string;
  minimumVersion: string;
  notes: string;
  publishedAt: string;
  /** The update artifacts this publication carries; at least one. */
  platforms: Partial<Record<ScoutDesktopUpdatePlatform, PublishedArtifact>>;
};

/** Build and validate the manifest for one release. */
export function buildUpdateManifest(
  input: BuildManifestInput,
): ScoutDesktopUpdateManifest {
  const platforms: Partial<
    Record<ScoutDesktopUpdatePlatform, ScoutDesktopUpdateArtifact>
  > = {};
  for (const [key, published] of Object.entries(input.platforms)) {
    const platform = ScoutDesktopUpdatePlatformSchema.parse(key);
    const { fileName, ...artifact } = published;
    platforms[platform] = {
      url: publicUrl(releaseObjectKey(input.version, fileName)),
      ...artifact,
    };
  }
  return ScoutDesktopUpdateManifestSchema.parse({
    schema: SCOUT_DESKTOP_UPDATE_SCHEMA,
    schemaMinor: SCOUT_DESKTOP_UPDATE_SCHEMA_MINOR,
    channel: input.channel,
    version: input.version,
    minimumVersion: input.minimumVersion,
    publishedAt: input.publishedAt,
    notes: input.notes,
    platforms,
  });
}

/**
 * The manifest to publish, given the live one and a candidate built from the
 * artifacts on this machine.
 *
 * Windows and macOS are built on different hosts, so one version reaches the
 * channel in up to two publications. The first publishes a newer version with
 * its own platform (after the never-downgrade checks); a later one for the
 * same version adds a platform the live manifest lacks and keeps everything
 * else, including the notes and minimum version, which must match. A platform
 * already live is never replaced: identical bytes mean there is nothing to
 * publish, different ones mean a version bump.
 */
export function resolvePublication(
  live: ScoutDesktopUpdateManifest | null,
  candidate: ScoutDesktopUpdateManifest,
): ScoutDesktopUpdateManifest {
  if (
    live?.channel !== candidate.channel ||
    compareScoutDesktopVersions(candidate.version, live.version) !== 0
  ) {
    assertNeverDowngrade(live, candidate);
    return candidate;
  }
  const added = Object.entries(candidate.platforms).filter(
    ([platform, artifact]) => {
      const current =
        live.platforms[ScoutDesktopUpdatePlatformSchema.parse(platform)];
      if (current === undefined) return true;
      if (!isDeepStrictEqual(current, artifact)) {
        throw new Error(
          `Version ${candidate.version} is already live on ${candidate.channel} with a different ${platform} artifact; bump the version`,
        );
      }
      return false;
    },
  );
  if (added.length === 0) {
    throw new Error(
      `Version ${candidate.version} is already live on ${candidate.channel}; bump the version`,
    );
  }
  if (candidate.notes !== live.notes) {
    throw new Error(
      `Version ${candidate.version} is live with other release notes; publish the second platform with the same notes file`,
    );
  }
  if (candidate.minimumVersion !== live.minimumVersion) {
    throw new Error(
      `Version ${candidate.version} is live with minimum version ${live.minimumVersion}; a second platform cannot change it`,
    );
  }
  return ScoutDesktopUpdateManifestSchema.parse({
    ...live,
    platforms: { ...live.platforms, ...Object.fromEntries(added) },
  });
}

/**
 * Refuse to publish a version that does not outrank the live channel. Equal
 * versions are refused too: a release is immutable, so republishing is a bump.
 */
export function assertNeverDowngrade(
  live: ScoutDesktopUpdateManifest | null,
  candidate: ScoutDesktopUpdateManifest,
): void {
  if (live === null) return;
  if (live.channel !== candidate.channel) {
    throw new Error(
      `The live manifest is for ${live.channel}, not ${candidate.channel}`,
    );
  }
  const order = compareScoutDesktopVersions(candidate.version, live.version);
  if (order < 0) {
    throw new Error(
      `Refusing to downgrade the ${candidate.channel} channel from ${live.version} to ${candidate.version}`,
    );
  }
  if (order === 0) {
    throw new Error(
      `Version ${candidate.version} is already live on ${candidate.channel}; bump the version`,
    );
  }
  // Lowering the floor would let builds the backend already refused update to
  // nothing, and read as a rollback of the requirement.
  if (
    compareScoutDesktopVersions(candidate.minimumVersion, live.minimumVersion) <
    0
  ) {
    throw new Error(
      `Refusing to lower the ${candidate.channel} minimum version from ${live.minimumVersion} to ${candidate.minimumVersion}`,
    );
  }
}
