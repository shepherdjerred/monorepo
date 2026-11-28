import type { RankedRenovateUpdate } from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { z } from "zod";

export const AgeConfigSchema = z
  .object({
    minimumReleaseAge: z.string().nullish(),
    minimumReleaseAgeBuffer: z.string().nullish(),
    minimumReleaseAgeBehaviour: z.string().optional(),
    minimumReleaseAgePackageManagerSync: z.boolean().optional(),
    internalChecksFilter: z.string().optional(),
    packageRules: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

const PackageAgeRuleSchema = z.object({
  matchPackageNames: z.array(z.string()).min(1).optional(),
  matchDatasources: z.array(z.string()).min(1).optional(),
  minimumReleaseAge: z.string().nullish(),
  minimumReleaseAgeBuffer: z.string().nullish(),
  minimumReleaseAgeBehaviour: z.string().optional(),
});

export type AgeConfig = z.infer<typeof AgeConfigSchema>;
type Bake = RankedRenovateUpdate["bake"];

type Release = {
  readonly updateType?: string | undefined;
  readonly releaseTimestamp?: string | null | undefined;
  readonly pendingChecks?: boolean | undefined;
};

const AGE_TYPES_WITHOUT_RELEASE = new Set([
  "bump",
  "lockFileMaintenance",
  "lockfileUpdate",
  "pin",
  "replacement",
  "rollback",
]);
const AGE_SETTING_KEYS = [
  "minimumReleaseAge",
  "minimumReleaseAgeBuffer",
  "minimumReleaseAgeBehaviour",
  "minimumReleaseAgePackageManagerSync",
] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function durationMs(value: string | null): number | undefined {
  if (value === null) return 0;
  const match = /^(\d+)\s*(minute|hour|day|week)s?$/u.exec(value);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const units: Record<string, number> = {
    minute: MINUTE_MS,
    hour: HOUR_MS,
    day: DAY_MS,
    week: 7 * DAY_MS,
  };
  const result = amount * (units[match[2] ?? ""] ?? Number.NaN);
  return Number.isSafeInteger(result) ? result : undefined;
}

function hasScopedAgeSettings(config: AgeConfig): boolean {
  return Object.values(config).some((nested) => {
    const parsed = z.record(z.string(), z.unknown()).safeParse(nested);
    return parsed.success && AGE_SETTING_KEYS.some((key) => key in parsed.data);
  });
}

function isExactSelector(name: string): boolean {
  return !name.startsWith("/") && !/[*?!{}()[\]\\]/u.test(name);
}

function parseAgeRule(rule: Record<string, unknown>) {
  const supported = Object.keys(rule).every(
    (key) =>
      !key.startsWith("match") ||
      key === "matchPackageNames" ||
      key === "matchDatasources",
  );
  const parsed = PackageAgeRuleSchema.safeParse(rule);
  if (
    !supported ||
    !parsed.success ||
    rule["minimumReleaseAgePackageManagerSync"] === true
  )
    return null;
  const selectors = [
    ...(parsed.data.matchPackageNames ?? []),
    ...(parsed.data.matchDatasources ?? []),
  ];
  return selectors.every((name) => isExactSelector(name)) ? parsed.data : null;
}

function ageRuleMatches(
  rule: z.infer<typeof PackageAgeRuleSchema>,
  lookupName: string,
  datasource: string | null,
): boolean {
  const matchesName =
    rule.matchPackageNames?.some(
      (name) => name.toLowerCase() === lookupName.toLowerCase(),
    ) ?? true;
  return (
    matchesName && (rule.matchDatasources?.includes(datasource ?? "") ?? true)
  );
}

function effectiveAge(
  config: AgeConfig,
  lookupName: string,
  datasource: string | null,
):
  | {
      ageMs: number;
      timestampOptional: boolean;
    }
  | undefined {
  if (
    config.minimumReleaseAgePackageManagerSync === true ||
    hasScopedAgeSettings(config)
  ) {
    return undefined;
  }
  let age = config.minimumReleaseAge ?? null;
  // Renovate 44 defaults to a 30-minute buffer where a nonzero age applies.
  let buffer =
    config.minimumReleaseAgeBuffer === undefined
      ? "30 minutes"
      : config.minimumReleaseAgeBuffer;
  let behavior = config.minimumReleaseAgeBehaviour;
  for (const rule of config.packageRules ?? []) {
    if (!AGE_SETTING_KEYS.some((key) => key in rule)) continue;
    // These are the selector shapes currently used by the repo's age rules.
    // Keep unsupported selectors out of the publishable set.
    const parsed = parseAgeRule(rule);
    if (parsed === null) return undefined;
    if (!ageRuleMatches(parsed, lookupName, datasource)) continue;
    if (parsed.minimumReleaseAge !== undefined) age = parsed.minimumReleaseAge;
    if (parsed.minimumReleaseAgeBuffer !== undefined)
      buffer = parsed.minimumReleaseAgeBuffer;
    behavior = parsed.minimumReleaseAgeBehaviour ?? behavior;
  }
  const ageMs = durationMs(age);
  const bufferMs = durationMs(buffer);
  if (ageMs === undefined || bufferMs === undefined) return undefined;
  return {
    ageMs: ageMs === 0 ? 0 : ageMs + bufferMs,
    timestampOptional: behavior === "timestamp-optional",
  };
}

export function bakeForUpdate(input: {
  config: AgeConfig;
  lookupName: string;
  datasource: string | null;
  update: Release;
  now: Date;
}): Bake {
  const { config, lookupName, datasource, update, now } = input;
  const policy = effectiveAge(config, lookupName, datasource);
  if (policy === undefined) {
    return {
      state: "unknown",
      eligibleAt: null,
      reason: "Release-age policy needs verification.",
    };
  }
  if (config.internalChecksFilter !== "strict" && policy.ageMs > 0) {
    return {
      state: "unknown",
      eligibleAt: null,
      reason: "Renovate lookup did not use strict release-age checks.",
    };
  }
  if (
    policy.ageMs === 0 ||
    AGE_TYPES_WITHOUT_RELEASE.has(update.updateType ?? "")
  ) {
    return update.pendingChecks === true
      ? {
          state: "unknown",
          eligibleAt: null,
          reason: "Renovate reports pending internal checks.",
        }
      : {
          state: "ready",
          eligibleAt: null,
          reason: "No release-age wait applies.",
        };
  }
  const timestamp = Date.parse(update.releaseTimestamp ?? "");
  if (!Number.isFinite(timestamp)) {
    if (update.pendingChecks === true) {
      return {
        state: "unknown",
        eligibleAt: null,
        reason:
          "Renovate reports pending checks without an exact release timestamp.",
      };
    }
    if (
      policy.timestampOptional ||
      update.updateType === "digest" ||
      update.updateType === "pinDigest"
    ) {
      // Digest-only updates are checked by Renovate against the registry
      // timestamp, which is not copied to the exact update's releaseTimestamp.
      return {
        state: "ready",
        eligibleAt: null,
        reason: "The strict Renovate lookup passed the release-age policy.",
      };
    }
    return {
      state: "unknown",
      eligibleAt: null,
      reason: "The exact release timestamp is missing.",
    };
  }
  const readyAt = timestamp + policy.ageMs;
  const eligibleAt = new Date(readyAt).toISOString();
  if (readyAt > now.getTime()) {
    return {
      state: "waiting",
      eligibleAt,
      reason: "The target is still within its release-age wait.",
    };
  }
  return update.pendingChecks === true
    ? {
        state: "unknown",
        eligibleAt,
        reason: "Renovate still reports pending checks.",
      }
    : {
        state: "ready",
        eligibleAt,
        reason: "The exact release passed its release-age wait.",
      };
}
