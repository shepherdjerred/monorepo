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
 * Compatibility. `schema` is the major version and `schemaMinor` the minor.
 * Additive changes (a new platform key, a new field anywhere) bump only the
 * minor: an installed client ignores platforms it does not run on, including
 * keys it has never heard of, ignores unknown fields, and accepts any minor,
 * while still validating its own platform entry strictly. A breaking change
 * bumps the major and ships at a new manifest path (for example
 * `<channel>.v2.json`) while the publisher keeps writing the old path, so old
 * clients keep reading the major they understand; a client that does meet an
 * unknown major refuses it with a typed error. The publication schema below
 * stays strict: it writes exactly the current contract.
 *
 * The manifest is transport metadata, not the trust root. Every artifact is
 * also signed (minisign, by `cargo packager`) and the client verifies that
 * signature against a public key compiled into the build, so a tampered or
 * substituted manifest cannot install anything.
 */
export const SCOUT_DESKTOP_UPDATE_ORIGIN = rawContract.origin;
export const SCOUT_DESKTOP_UPDATE_SCHEMA = rawContract.contractVersion;
export const SCOUT_DESKTOP_UPDATE_SCHEMA_MINOR =
  rawContract.contractMinorVersion;
export const SCOUT_DESKTOP_UPDATE_LIMITS = rawContract.limits;
export const SCOUT_DESKTOP_UPDATE_CACHE_CONTROL = rawContract.cacheControl;

export const ScoutDesktopUpdateChannelSchema = z.enum(["stable", "beta"]);
export type ScoutDesktopUpdateChannel = z.infer<
  typeof ScoutDesktopUpdateChannelSchema
>;

/**
 * What a platform's update artifact is: `nsis` is the `cargo packager` NSIS
 * installer (Windows); `app` is a gzipped tar of the signed, notarized and
 * stapled `.app` bundle (macOS), which the client unpacks in place.
 */
export const ScoutDesktopUpdateFormatSchema = z.enum(["nsis", "app"]);
export type ScoutDesktopUpdateFormat = z.infer<
  typeof ScoutDesktopUpdateFormatSchema
>;

/** Platforms the channel ships, each with the one format it installs from. */
export const ScoutDesktopUpdatePlatformSchema = z.enum([
  "windows-x86_64",
  "darwin-universal",
]);
export type ScoutDesktopUpdatePlatform = z.infer<
  typeof ScoutDesktopUpdatePlatformSchema
>;

const PLATFORM_FORMATS: Record<
  ScoutDesktopUpdatePlatform,
  readonly ScoutDesktopUpdateFormat[]
> = {
  "windows-x86_64": ["nsis"],
  "darwin-universal": ["app"],
};

/** The formats `platform` installs from, as the shared contract lists them. */
export function scoutDesktopPlatformFormats(
  platform: ScoutDesktopUpdatePlatform,
): readonly ScoutDesktopUpdateFormat[] {
  return PLATFORM_FORMATS[platform];
}

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
/** An artifact as a client reads it: later additive fields are ignored. */
const ScoutDesktopUpdateArtifactLooseSchema = z.looseObject(
  ScoutDesktopUpdateArtifactSchema.shape,
);

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

type ManifestShape = {
  channel: ScoutDesktopUpdateChannel;
  version: string;
  minimumVersion: string;
  publishedAt: string;
  platforms: Record<string, unknown>;
};

/**
 * The rules JSON shape cannot express. `check` names the platform entries to
 * validate: the publisher checks every entry it writes, a reader only its own.
 */
function refineManifest(
  manifest: ManifestShape,
  context: z.RefinementCtx,
  check: readonly ScoutDesktopUpdatePlatform[],
): void {
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
  if (Object.keys(manifest.platforms).length === 0) {
    context.addIssue({
      code: "custom",
      path: ["platforms"],
      message: "a release needs at least one platform artifact",
    });
  }
  for (const platform of check) {
    const artifact = ScoutDesktopUpdateArtifactSchema.safeParse(
      manifest.platforms[platform],
    );
    if (!artifact.success) continue;
    if (!PLATFORM_FORMATS[platform].includes(artifact.data.format)) {
      context.addIssue({
        code: "custom",
        path: ["platforms", platform, "format"],
        message: `${platform} installs from ${PLATFORM_FORMATS[platform].join(" or ")}, not ${artifact.data.format}`,
      });
    }
    if (parseArtifactUrl(artifact.data.url, manifest.version) === undefined) {
      context.addIssue({
        code: "custom",
        path: ["platforms", platform, "url"],
        message: `artifact url must be ${rawContract.origin}/releases/${manifest.version}/<file>`,
      });
    }
  }
}

const MANIFEST_FIELDS = {
  channel: ScoutDesktopUpdateChannelSchema,
  version: ScoutDesktopVersionSchema,
  /** Builds below this must update; the backend enforces it with HTTP 426. */
  minimumVersion: ScoutDesktopVersionSchema,
  publishedAt: z.string().regex(PUBLISHED_AT_PATTERN),
  notes: z.string().max(rawContract.limits.notesMaxBytes),
};

/**
 * What the publication script writes, and nothing else: strict at every level,
 * at the contract's current major and minor. Publishing is the one place an
 * unknown platform or field is a mistake.
 */
export const ScoutDesktopUpdateManifestSchema = z
  .strictObject({
    schema: z.literal(rawContract.contractVersion),
    schemaMinor: z.literal(rawContract.contractMinorVersion),
    ...MANIFEST_FIELDS,
    platforms: z.strictObject({
      "windows-x86_64": ScoutDesktopUpdateArtifactSchema.optional(),
      "darwin-universal": ScoutDesktopUpdateArtifactSchema.optional(),
    }),
  })
  .superRefine((manifest, context) => {
    refineManifest(manifest, context, ScoutDesktopUpdatePlatformSchema.options);
  });

export type ScoutDesktopUpdateManifest = z.infer<
  typeof ScoutDesktopUpdateManifestSchema
>;

/**
 * Raised for a manifest at a major this reader does not understand. It is
 * thrown before the rest of the document is looked at, because a breaking
 * change may have reshaped it.
 */
export class ScoutDesktopUnsupportedSchemaError extends Error {
  constructor(readonly found: unknown) {
    super(
      `the update manifest is schema ${String(found)}, this reader understands schema ${String(rawContract.contractVersion)}`,
    );
    this.name = "ScoutDesktopUnsupportedSchemaError";
  }
}

/** The parts of a manifest a client for `platform` reads, validated. */
export type ScoutDesktopUpdateManifestRead = {
  channel: ScoutDesktopUpdateChannel;
  version: string;
  minimumVersion: string;
  notes: string;
  artifact: ScoutDesktopUpdateArtifact | undefined;
};

/**
 * Read a manifest the way an installed client does (the Rust client mirrors
 * this and shares the fixtures): refuse another major with
 * `ScoutDesktopUnsupportedSchemaError`, accept any minor, ignore unknown
 * fields and every platform but `platform` (including keys it has never
 * heard of), and validate everything it does use strictly, its own entry
 * included.
 */
export function readScoutDesktopUpdateManifest(
  raw: unknown,
  platform: ScoutDesktopUpdatePlatform,
): ScoutDesktopUpdateManifestRead {
  const major = z.looseObject({ schema: z.unknown() }).parse(raw).schema;
  if (major !== rawContract.contractVersion) {
    throw new ScoutDesktopUnsupportedSchemaError(major);
  }
  const manifest = z
    .looseObject({
      schemaMinor: z.number().int().nonnegative(),
      ...MANIFEST_FIELDS,
      platforms: z.looseObject({
        [platform]: ScoutDesktopUpdateArtifactLooseSchema.optional(),
      }),
    })
    .superRefine((value, context) => {
      refineManifest(value, context, [platform]);
    })
    .parse(raw);
  return {
    channel: manifest.channel,
    version: manifest.version,
    minimumVersion: manifest.minimumVersion,
    notes: manifest.notes,
    artifact: manifest.platforms[platform],
  };
}
