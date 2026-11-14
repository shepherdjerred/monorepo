import {
  SCOUT_DESKTOP_UPDATE_ORIGIN,
  ScoutDesktopUpdateManifestSchema,
  compareScoutDesktopVersions,
  type ScoutDesktopUpdateArtifact,
  type ScoutDesktopUpdateChannel,
  type ScoutDesktopUpdateManifest,
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

export type PublishedArtifact = Omit<ScoutDesktopUpdateArtifact, "url"> & {
  /** Name the installer is uploaded under, inside `releases/<version>/`. */
  fileName: string;
};

export type BuildManifestInput = {
  channel: ScoutDesktopUpdateChannel;
  version: string;
  minimumVersion: string;
  notes: string;
  publishedAt: string;
  windows: PublishedArtifact;
};

/** Build and validate the manifest for one release. */
export function buildUpdateManifest(
  input: BuildManifestInput,
): ScoutDesktopUpdateManifest {
  const { fileName, ...artifact } = input.windows;
  return ScoutDesktopUpdateManifestSchema.parse({
    schema: 1,
    channel: input.channel,
    version: input.version,
    minimumVersion: input.minimumVersion,
    publishedAt: input.publishedAt,
    notes: input.notes,
    platforms: {
      "windows-x86_64": {
        url: publicUrl(releaseObjectKey(input.version, fileName)),
        ...artifact,
      },
    },
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
