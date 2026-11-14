import { z } from "zod";
import rawContract from "./desktop-update-manifest.contract.json" with { type: "json" };

/**
 * The channel manifest the Scout desktop client polls for updates:
 * `<origin>/<channel>.json`, written by an operator-run publication script and
 * read by the Rust client. The language-neutral source of truth is
 * `desktop-update-manifest.contract.json`; the client validates the same
 * contract and `desktop-update-manifest.fixtures.json` with serde, and
 * `desktop-update-manifest.schema.test.ts` fails if either drifts.
 *
 * The manifest is transport metadata, not the trust root. Every artifact is
 * also signed (minisign, by `cargo packager`) and the client verifies that
 * signature against a public key compiled into the build, so a tampered or
 * substituted manifest cannot install anything.
 */
export const SCOUT_DESKTOP_UPDATE_ORIGIN = rawContract.origin;
export const SCOUT_DESKTOP_UPDATE_LIMITS = rawContract.limits;
export const SCOUT_DESKTOP_UPDATE_CACHE_CONTROL = rawContract.cacheControl;

export const ScoutDesktopUpdateChannelSchema = z.enum(["stable", "beta"]);
export type ScoutDesktopUpdateChannel = z.infer<
  typeof ScoutDesktopUpdateChannelSchema
>;

export const ScoutDesktopUpdateFormatSchema = z.enum(["nsis"]);

const VERSION_PATTERN = new RegExp(rawContract.versionPattern, "i");
const FILE_NAME_PATTERN = new RegExp(rawContract.fileNamePattern);
const PUBLISHED_AT_PATTERN = new RegExp(rawContract.publishedAtPattern);

/** Semantic version with an optional short pre-release; bounded and path-free. */
export const ScoutDesktopVersionSchema = z
  .string()
  .max(rawContract.limits.versionMaxBytes)
  .regex(VERSION_PATTERN);

export const ScoutDesktopUpdateArtifactSchema = z.strictObject({
  url: z.string().max(512),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive().max(rawContract.limits.artifactMaxBytes),
  signature: z
    .string()
    .max(rawContract.limits.signatureMaxBytes)
    .regex(/^[a-z0-9+/]{16,}={0,2}$/i),
  format: ScoutDesktopUpdateFormatSchema,
});
export type ScoutDesktopUpdateArtifact = z.infer<
  typeof ScoutDesktopUpdateArtifactSchema
>;

type VersionParts = { core: [number, number, number]; pre: string[] };

function versionParts(version: string): VersionParts {
  const separator = version.indexOf("-");
  const core = separator === -1 ? version : version.slice(0, separator);
  const pre = separator === -1 ? "" : version.slice(separator + 1);
  const numbers = core.split(".").map(Number);
  return {
    core: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0],
    pre: pre === "" ? [] : pre.split("."),
  };
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric)
    return Math.sign(Number(left) - Number(right));
  // Numeric identifiers sort below alphanumeric ones.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any pre-release of the same core version.
  if (a.length === 0 || b.length === 0) {
    if (a.length === b.length) return 0;
    return a.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = compareIdentifier(a[index] ?? "", b[index] ?? "");
    if (order !== 0) return order;
  }
  return Math.sign(a.length - b.length);
}

/** Semver precedence of two app versions: negative, zero or positive. */
export function compareScoutDesktopVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return comparePre(left.pre, right.pre);
}

/**
 * The artifact URL, when it is exactly
 * `<origin>/releases/<version>/<file>` with a plain lowercase file name.
 */
function parseArtifactUrl(raw: string, version: string): URL | undefined {
  const prefix = `/releases/${version}/`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const inPlace =
    url.origin === rawContract.origin &&
    url.search === "" &&
    url.hash === "" &&
    url.pathname.startsWith(prefix);
  return inPlace && FILE_NAME_PATTERN.test(url.pathname.slice(prefix.length))
    ? url
    : undefined;
}

export const ScoutDesktopUpdateManifestSchema = z
  .strictObject({
    schema: z.literal(rawContract.contractVersion),
    channel: ScoutDesktopUpdateChannelSchema,
    version: ScoutDesktopVersionSchema,
    /** Builds below this must update; the backend enforces it with HTTP 426. */
    minimumVersion: ScoutDesktopVersionSchema,
    publishedAt: z.string().regex(PUBLISHED_AT_PATTERN),
    notes: z.string().max(rawContract.limits.notesMaxBytes),
    platforms: z.strictObject({
      "windows-x86_64": ScoutDesktopUpdateArtifactSchema.optional(),
    }),
  })
  .superRefine((manifest, context) => {
    if (Number.isNaN(Date.parse(manifest.publishedAt))) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "publishedAt is not a real date",
      });
    }
    if (
      compareScoutDesktopVersions(manifest.minimumVersion, manifest.version) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["minimumVersion"],
        message: "minimumVersion is newer than version",
      });
    }
    const artifacts = Object.entries(manifest.platforms);
    if (artifacts.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["platforms"],
        message: "a release needs at least one platform artifact",
      });
    }
    for (const [platform, artifact] of artifacts) {
      if (artifact === undefined) continue;
      if (parseArtifactUrl(artifact.url, manifest.version) === undefined) {
        context.addIssue({
          code: "custom",
          path: ["platforms", platform, "url"],
          message: `artifact url must be ${rawContract.origin}/releases/${manifest.version}/<file>`,
        });
      }
    }
  });

export type ScoutDesktopUpdateManifest = z.infer<
  typeof ScoutDesktopUpdateManifestSchema
>;
