import { z } from "zod";

import { parseVersionsSource } from "./pin-candidates.ts";

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

export const ScoutReleaseContentSchema = ScoutReleaseStateSchema.pick({
  sourceCommit: true,
  backendImageDigest: true,
  siteArchiveDigest: true,
  betaSiteArchiveDigest: true,
  releaseInputDigest: true,
});

export type ScoutReleaseContent = z.infer<typeof ScoutReleaseContentSchema>;

const ScoutArchiveFlavorSchema = z.enum(["prod", "beta"]);
const ScoutArchiveRecordSchema = z.union([
  ScoutReleaseContentSchema.extend({
    schema: z.literal("scout-site-archive/v1"),
    flavor: ScoutArchiveFlavorSchema,
  }).strict(),
  ScoutReleaseStateSchema.extend({
    flavor: ScoutArchiveFlavorSchema,
  }).strict(),
]);

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

export function scoutReleaseContent(
  state: ScoutReleaseState,
): ScoutReleaseContent {
  return ScoutReleaseContentSchema.parse({
    sourceCommit: state.sourceCommit,
    backendImageDigest: state.backendImageDigest,
    siteArchiveDigest: state.siteArchiveDigest,
    betaSiteArchiveDigest: state.betaSiteArchiveDigest,
    releaseInputDigest: state.releaseInputDigest,
  });
}

export function sameScoutReleaseContent(
  left: ScoutReleaseContent,
  right: ScoutReleaseContent,
): boolean {
  return (
    left.sourceCommit === right.sourceCommit &&
    left.backendImageDigest === right.backendImageDigest &&
    left.siteArchiveDigest === right.siteArchiveDigest &&
    left.betaSiteArchiveDigest === right.betaSiteArchiveDigest &&
    left.releaseInputDigest === right.releaseInputDigest
  );
}

export function archiveRecord(
  state: ScoutReleaseState,
  flavor: "prod" | "beta",
): string {
  return `${JSON.stringify(
    {
      schema: "scout-site-archive/v1",
      flavor,
      ...scoutReleaseContent(state),
    },
    null,
    2,
  )}\n`;
}

export function assertArchiveRecordMatchesState(
  content: string,
  state: ScoutReleaseState,
  flavor: "prod" | "beta",
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error("Scout archive record is not valid JSON", { cause: error });
  }
  const record = ScoutArchiveRecordSchema.parse(parsed);
  if (record.flavor !== flavor || !sameScoutReleaseContent(record, state)) {
    throw new Error(`immutable ${flavor} archive record does not match state`);
  }
}

export function inputRecordMatchesState(
  content: string,
  state: ScoutReleaseState,
): boolean {
  return sameScoutReleaseContent(parseScoutReleaseState(content), state);
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
  const pin = parseVersionsSource(versionsSource).get(
    "shepherdjerred/scout-for-lol/beta",
  );
  const digest = pin?.split("@")[1];
  if (digest === undefined || !CANONICAL_DIGEST_PATTERN.test(digest)) {
    throw new Error("Scout beta pin has no canonical digest");
  }
  return digest;
}

export function resolveProdPin(versionsSource: string): string {
  const pin = parseVersionsSource(versionsSource).get(
    "shepherdjerred/scout-for-lol/prod",
  );
  if (pin === undefined) {
    throw new Error("Scout prod pin is missing");
  }
  const [version, digest, ...extra] = pin.split("@");
  if (
    version === undefined ||
    !SCOUT_VERSION_PATTERN.test(version) ||
    digest === undefined ||
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
