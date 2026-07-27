import { z } from "zod";
import { DEV_PLACEHOLDER } from "@scout-for-lol/data/build-identity.ts";

/**
 * Build identity stamped into this bundle at site-release build time
 * (scripts/scout-site-release.ts → VITE_APP_VERSION / VITE_GIT_SHA /
 * VITE_CONTRACT_HASH). All absent in local dev, where the fallback "dev"
 * values also disable the contract-mismatch banner.
 */
const EnvSchema = z.object({
  VITE_APP_VERSION: z.string().min(1).optional(),
  VITE_GIT_SHA: z.string().min(1).optional(),
  VITE_CONTRACT_HASH: z.string().min(1).optional(),
});

export type BuildInfo = {
  version: string;
  gitSha: string;
  contractHash: string;
};

function readBuildInfo(): BuildInfo {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const env = parsed.success ? parsed.data : {};
  return {
    version: env.VITE_APP_VERSION ?? DEV_PLACEHOLDER,
    gitSha: env.VITE_GIT_SHA ?? DEV_PLACEHOLDER,
    contractHash: env.VITE_CONTRACT_HASH ?? DEV_PLACEHOLDER,
  };
}

/** This bundle's build identity. */
export const buildInfo: BuildInfo = readBuildInfo();

/** Shape of GET /api/version (the backend's build identity). */
export const VersionResponseSchema = z.object({
  version: z.string().min(1),
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
  if (localHash === DEV_PLACEHOLDER || remoteHash === DEV_PLACEHOLDER) {
    return false;
  }
  if (localHash.length === 0 || remoteHash.length === 0) {
    return false;
  }
  return localHash !== remoteHash;
}

/** First 7 chars of a git SHA (or the whole string when shorter). */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
