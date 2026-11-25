import { z } from "zod";

const SemverPattern =
  /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9a-z.-]+))?(?:\+[0-9a-z.-]+)?$/iu;

export type ParsedSemver = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string | undefined;
};

/**
 * Strip OCI digest suffixes, wrapper prefixes (`v`, `version-`, `corretto-`),
 * and common container variant suffixes when extracting a clean version string.
 */
export function normalizeVersionString(
  raw: string | null | undefined,
): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  let cleaned = raw.trim();
  if (cleaned === "") {
    return null;
  }
  const atIndex = cleaned.indexOf("@");
  if (atIndex !== -1) {
    cleaned = cleaned.slice(0, atIndex).trim();
  }
  if (cleaned === "" || cleaned === "latest") {
    return null;
  }
  cleaned = cleaned
    .replace(/^version-/iu, "")
    .replace(/^corretto-/iu, "")
    .replace(/-nonroot$/iu, "");
  if (/^v\d/iu.test(cleaned)) {
    cleaned = cleaned.slice(1);
  }
  return cleaned === "" ? null : cleaned;
}

/**
 * Extract normalized repository path and version tag from a container image
 * reference such as `ghcr.io/org/app:v2.14.2@sha256:abc...`.
 */
export function parseContainerImageReference(imageRef: string): {
  readonly repository: string;
  readonly version: string | null;
} | null {
  const trimmed = imageRef.trim();
  if (trimmed === "") {
    return null;
  }
  const withoutDigest = (trimmed.split("@")[0] ?? trimmed).trim();
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  if (lastColon === -1 || lastColon < lastSlash) {
    return {
      repository: normalizeImageRepo(withoutDigest),
      version: null,
    };
  }
  const repoPart = withoutDigest.slice(0, lastColon);
  const tagPart = withoutDigest.slice(lastColon + 1);
  return {
    repository: normalizeImageRepo(repoPart),
    version: normalizeContainerTag(tagPart),
  };
}

const DISTRO_SUFFIX_PREFIXES = [
  "alpine",
  "slim",
  "bookworm",
  "bullseye",
  "jammy",
  "noble",
  "amd64",
  "arm64",
  "java",
] as const;

function normalizeContainerTag(tag: string): string | null {
  const base = normalizeVersionString(tag);
  if (base === null) {
    return null;
  }
  const dashIndex = base.indexOf("-");
  if (dashIndex === -1) {
    return base;
  }
  const versionPart = base.slice(0, dashIndex);
  const suffixPart = base.slice(dashIndex + 1).toLowerCase();
  const isNumericPrefix = /^\d+\.\d+(?:\.\d+){0,2}$/u.test(versionPart);
  const isDistroSuffix = DISTRO_SUFFIX_PREFIXES.some((prefix) =>
    suffixPart.startsWith(prefix),
  );
  return isNumericPrefix && isDistroSuffix ? versionPart : base;
}

export function normalizeImageRepo(repo: string): string {
  return repo
    .trim()
    .toLowerCase()
    .replace(/^(?:index\.)?docker\.io\//u, "")
    .replace(/^library\//u, "")
    .replace(/^ghcr\.io\//u, "")
    .replace(/^quay\.io\//u, "")
    .replace(/^registry\.k8s\.io\//u, "");
}

export function parseSemver(version: string): ParsedSemver | undefined {
  const normalized = normalizeVersionString(version);
  if (normalized === null) {
    return undefined;
  }
  const direct = SemverPattern.exec(normalized);
  if (direct?.[1] !== undefined && direct[2] !== undefined) {
    return {
      major: Number(direct[1]),
      minor: Number(direct[2]),
      patch: direct[3] === undefined ? 0 : Number(direct[3]),
      prerelease: direct[4],
    };
  }
  const embedded = /[@/-]v?(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?$/iu.exec(
    version.trim(),
  );
  if (
    embedded?.[1] !== undefined &&
    embedded[2] !== undefined &&
    embedded[3] !== undefined
  ) {
    return {
      major: Number(embedded[1]),
      minor: Number(embedded[2]),
      patch: Number(embedded[3]),
      prerelease: embedded[4],
    };
  }
  return undefined;
}

function comparePrerelease(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left === right) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  return right === undefined
    ? -1
    : left.localeCompare(right, undefined, { numeric: true });
}

export function compareSemver(left: string, right: string): number | undefined {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  if (leftParsed === undefined || rightParsed === undefined) {
    return undefined;
  }
  if (leftParsed.major !== rightParsed.major) {
    return leftParsed.major - rightParsed.major;
  }
  if (leftParsed.minor !== rightParsed.minor) {
    return leftParsed.minor - rightParsed.minor;
  }
  return leftParsed.patch === rightParsed.patch
    ? comparePrerelease(leftParsed.prerelease, rightParsed.prerelease)
    : leftParsed.patch - rightParsed.patch;
}

/**
 * True when `candidateTag` lies strictly in `(lowerExclusive, upperInclusive]`
 * when `lowerExclusive` is known, or matches `upperInclusive` when `lowerExclusive` is null.
 */
export function isVersionInDeltaWindow(input: {
  readonly candidateTag: string;
  readonly effectiveFromVersion: string | null;
  readonly targetVersion: string;
}): boolean {
  const { candidateTag, effectiveFromVersion, targetVersion } = input;
  const upperCmp = compareSemver(candidateTag, targetVersion);
  if (effectiveFromVersion === null) {
    return upperCmp === undefined
      ? normalizeVersionString(candidateTag) ===
          normalizeVersionString(targetVersion)
      : upperCmp === 0;
  }
  const lowerCmp = compareSemver(candidateTag, effectiveFromVersion);
  if (lowerCmp !== undefined && upperCmp !== undefined) {
    return lowerCmp > 0 && upperCmp <= 0;
  }
  const normalizedCandidate = normalizeVersionString(candidateTag);
  const normalizedTarget = normalizeVersionString(targetVersion);
  const normalizedFrom = normalizeVersionString(effectiveFromVersion);
  return (
    normalizedCandidate !== null &&
    normalizedCandidate === normalizedTarget &&
    normalizedCandidate !== normalizedFrom
  );
}

export function approximateVersionsBehind(
  effectiveFromVersion: string | null,
  targetVersion: string,
  intermediateReleaseCount?: number,
): number | null {
  if (intermediateReleaseCount !== undefined && intermediateReleaseCount > 0) {
    return intermediateReleaseCount;
  }
  if (effectiveFromVersion === null) {
    return null;
  }
  const normalizedFrom = normalizeVersionString(effectiveFromVersion);
  const normalizedTarget = normalizeVersionString(targetVersion);
  return normalizedFrom !== null &&
    normalizedTarget !== null &&
    normalizedFrom === normalizedTarget
    ? 0
    : diffSemverDistance(effectiveFromVersion, targetVersion);
}

function positiveDiff(toVal: number, fromVal: number): number | null {
  return toVal > fromVal ? toVal - fromVal : null;
}

function diffSemverDistance(fromVer: string, toVer: string): number | null {
  const fromSemver = parseSemver(fromVer);
  const toSemver = parseSemver(toVer);
  if (fromSemver === undefined || toSemver === undefined) {
    return null;
  }
  if (toSemver.major !== fromSemver.major) {
    return positiveDiff(toSemver.major, fromSemver.major);
  }
  if (toSemver.minor !== fromSemver.minor) {
    return positiveDiff(toSemver.minor, fromSemver.minor);
  }
  return toSemver.patch === fromSemver.patch
    ? 0
    : positiveDiff(toSemver.patch, fromSemver.patch);
}

const HttpsUrlSchema = z
  .url()
  .refine((val) => val.startsWith("https://"), "Must be https://");

export function sanitizeHttpsUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = HttpsUrlSchema.safeParse(raw.trim());
  return parsed.success ? parsed.data : undefined;
}

export function sanitizeHttpsUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    const valid = sanitizeHttpsUrl(raw);
    if (valid !== undefined && !seen.has(valid)) {
      seen.add(valid);
      result.push(valid);
    }
  }
  return result;
}
