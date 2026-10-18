import { z } from "zod";

import { parseVersionCatalogText } from "@shepherdjerred/version-catalog";

export const SCOUT_VERSION_PATTERN = /^2\.0\.0-\d+$/;
export const CANONICAL_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const ScoutReleaseStateSchema = z
  .object({
    schema: z.literal("scout-release-state/v1"),
    buildNumber: z.number().int().positive(),
    version: z.string().regex(SCOUT_VERSION_PATTERN),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    backendImageDigest: z.string().regex(CANONICAL_DIGEST_PATTERN),
    siteArchiveDigest: z.string().regex(CANONICAL_DIGEST_PATTERN),
    betaSiteArchiveDigest: z.string().regex(CANONICAL_DIGEST_PATTERN),
    releaseInputDigest: z.string().regex(CANONICAL_DIGEST_PATTERN),
  })
  .strict();

export type ScoutReleaseState = z.infer<typeof ScoutReleaseStateSchema>;

const LegacyScoutReleaseManifestSchema = z
  .object({
    version: z.string().regex(SCOUT_VERSION_PATTERN),
    gitSha: z.string().regex(/^[0-9a-f]{40}$/),
    builtAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type LegacyScoutReleaseManifest = z.infer<
  typeof LegacyScoutReleaseManifestSchema
>;

export function parseScoutReleaseState(text: string): ScoutReleaseState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("Scout release state is not valid JSON", { cause: error });
  }
  const state = ScoutReleaseStateSchema.parse(parsed);
  if (state.version !== `2.0.0-${state.buildNumber.toString()}`) {
    throw new Error("Scout release version does not match its build number");
  }
  return state;
}

export function parseLegacyScoutReleaseManifest(
  text: string,
): LegacyScoutReleaseManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("Legacy Scout release manifest is not valid JSON", {
      cause: error,
    });
  }
  return LegacyScoutReleaseManifestSchema.parse(parsed);
}

export function retagScoutReleaseState(
  state: ScoutReleaseState,
  buildNumber: number,
): ScoutReleaseState {
  if (!Number.isSafeInteger(buildNumber) || buildNumber <= 0) {
    throw new Error("Scout release build number must be a positive integer");
  }
  return ScoutReleaseStateSchema.parse({
    ...state,
    buildNumber,
    version: `2.0.0-${buildNumber.toString()}`,
  });
}

export function siteReleaseIdentity(state: ScoutReleaseState): string {
  return `scout-site@${state.releaseInputDigest}`;
}

export function resolveBackendDigest(
  candidateDigest: string | null,
  versionsSource: string,
): string {
  if (candidateDigest !== null) {
    if (!CANONICAL_DIGEST_PATTERN.test(candidateDigest)) {
      throw new Error("candidate backend digest is not canonical");
    }
    return candidateDigest;
  }
  const pin = parseVersionCatalogText(versionsSource).entries.find(
    (entry) => entry.name === "shepherdjerred/scout-for-lol/beta",
  )?.value;
  const digest = pin?.split("@")[1];
  if (digest === undefined || !CANONICAL_DIGEST_PATTERN.test(digest)) {
    throw new Error("Scout beta pin has no canonical digest");
  }
  return digest;
}

export function resolveProdPin(versionsSource: string): string {
  const pin = parseVersionCatalogText(versionsSource).entries.find(
    (entry) => entry.name === "shepherdjerred/scout-for-lol/prod",
  )?.value;
  if (pin === undefined) {
    throw new Error("Scout prod pin is missing");
  }
  const [version, digest, ...extra] = pin.split("@");
  if (
    version === undefined ||
    digest === undefined ||
    !SCOUT_VERSION_PATTERN.test(version) ||
    !CANONICAL_DIGEST_PATTERN.test(digest) ||
    extra.length > 0
  ) {
    throw new Error("Scout prod pin is not canonical");
  }
  return pin;
}

export function validateProdPinState(
  prodPin: string,
  state: ScoutReleaseState,
): void {
  const [version, digest, ...extra] = prodPin.split("@");
  if (
    version !== state.version ||
    digest !== state.backendImageDigest ||
    extra.length > 0
  ) {
    throw new Error(
      "production pin does not match archived Scout release state",
    );
  }
}
