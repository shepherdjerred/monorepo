import { z } from "zod";
import {
  DEV_PLACEHOLDER,
  scoutReleaseVersion,
} from "@scout-for-lol/data/build-identity.ts";

/**
 * Build identity stamped into this bundle at site-release build time
 * (scripts/release/scout-site-release.ts → VITE_SENTRY_RELEASE is the
 * content-addressed archive identity `scout-site@sha256:…`, VITE_CONTRACT_HASH
 * the tRPC contract hash). No build number or commit is baked in: the bytes
 * depend only on content, so an unchanged rebuild on a later commit reproduces
 * the same archive and Delivery retains it instead of registering a duplicate.
 * The human-facing release and commit come from the deployed backend
 * (GET /api/version). Both values are absent in local dev, where the "dev"
 * contract hash also disables the contract-mismatch chip.
 */
const EnvSchema = z.object({
  VITE_SENTRY_RELEASE: z.string().min(1).optional(),
  VITE_CONTRACT_HASH: z.string().min(1).optional(),
});

export type BuildInfo = {
  /** Content-addressed archive identity, or undefined outside a release build. */
  release: string | undefined;
  contractHash: string;
};

function readBuildInfo(): BuildInfo {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const env = parsed.success ? parsed.data : {};
  return {
    release: env.VITE_SENTRY_RELEASE,
    contractHash: env.VITE_CONTRACT_HASH ?? DEV_PLACEHOLDER,
  };
}

/** This bundle's build identity. */
export const buildInfo: BuildInfo = readBuildInfo();

/** Shape of GET /api/version (the backend's build identity). */
export const VersionResponseSchema = z.object({
  version: z.string().min(1).transform(scoutReleaseVersion),
  gitSha: z.string().min(1),
  contractHash: z.string().min(1),
  // Older backend images predate this owner-only diagnostic capability.
  canViewContractMismatch: z.boolean().default(false),
});

export type VersionResponse = z.infer<typeof VersionResponseSchema>;

/**
 * Whether the app bundle and the backend were built against different tRPC
 * contracts. Compares contract hashes only — NEVER versions: the backend
 * image is content-gated, so a healthy release pair routinely carries
 * different build numbers. A "dev"/unknown hash on either side disables the
 * check (local dev, pre-feature builds).
 */
export function isContractMismatch(
  localHash: string,
  remoteHash: string,
): boolean {
  return (
    localHash !== DEV_PLACEHOLDER &&
    remoteHash !== DEV_PLACEHOLDER &&
    localHash.length > 0 &&
    remoteHash.length > 0 &&
    localHash !== remoteHash
  );
}

/** First 7 chars of a git SHA (or the whole string when shorter). */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const ARCHIVE_DIGEST_MARKER = "@sha256:";

/**
 * Short form of the archive identity for the mismatch chip
 * (`scout-site@sha256:0123456789ab`), or "none" outside a release build.
 */
export function shortArchiveIdentity(release: string | undefined): string {
  if (release === undefined) return "none";
  const start = release.indexOf(ARCHIVE_DIGEST_MARKER);
  return start === -1
    ? release
    : release.slice(0, start + ARCHIVE_DIGEST_MARKER.length + 12);
}

/**
 * Footer release line: the deployed backend's version and commit. Undefined
 * until GET /api/version has answered, so the footer omits the line rather
 * than showing a placeholder — this bundle carries no build number of its own.
 */
export function deployedIdentity(
  backend: VersionResponse | undefined,
): { release: string; commit: string } | undefined {
  return backend === undefined
    ? undefined
    : { release: backend.version, commit: backend.gitSha };
}
