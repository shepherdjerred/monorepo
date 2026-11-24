import { createHash, timingSafeEqual } from "node:crypto";
import { defineConfig } from "@shepherdjerred/config";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { FeatureFlagModeSchema } from "@shepherdjerred/feature-flags/config/schema.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod";

export type EnvMap = Readonly<Record<string, string | undefined>>;

export const MAX_INGEST_BODY_BYTES = 2 * 1024 * 1024;
const MIN_INGEST_TOKEN_LENGTH = 24;
const PORT_PATTERN = /^(?:0|[1-9]\d*)$/u;

const BooleanSettingSchema = z.union([z.boolean(), z.stringbool()]);

export const STORM_STATS_BEHAVIOR_DEFINITION = {
  ingestEnabled: {
    schema: BooleanSettingSchema,
    sources: ["flag", "env", "default"],
    default: managedBooleanDefault("storm-stats-ingest-enabled", "prod"),
    names: {
      flag: "storm-stats-ingest-enabled",
      env: "STORM_STATS_INGEST_ENABLED",
    },
  },
  publicEnabled: {
    schema: BooleanSettingSchema,
    sources: ["flag", "env", "default"],
    default: managedBooleanDefault("storm-stats-public-enabled", "prod"),
    names: {
      flag: "storm-stats-public-enabled",
      env: "STORM_STATS_PUBLIC_ENABLED",
    },
  },
} as const;

export type StormStatsBootstrap = {
  readonly host: string;
  readonly port: number;
  readonly adminPort: number | undefined;
  readonly ingestPort: number | undefined;
  readonly ingestToken: string | undefined;
  readonly databasePath: string;
  readonly seedDemo: boolean;
  readonly featureFlagsMode: z.infer<typeof FeatureFlagModeSchema> | "disabled";
  readonly environment: string;
};

function parsePort(
  raw: string | undefined,
  envName: string,
): number | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  if (!PORT_PATTERN.test(raw)) {
    throw new Error(`Invalid ${envName}: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new Error(`Invalid ${envName}: ${raw}`);
  }
  return value;
}

function parseSeedDemo(raw: string | undefined): boolean {
  if (raw === undefined || raw.length === 0) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function assertDistinctPorts(
  port: number,
  adminPort: number | undefined,
  ingestPort: number | undefined,
): void {
  if (adminPort === port && adminPort > 0) {
    throw new Error(
      `STORM_STATS_ADMIN_PORT (${String(adminPort)}) must differ from PORT (${String(port)})`,
    );
  }
  if (ingestPort === port && ingestPort > 0) {
    throw new Error(
      `STORM_STATS_INGEST_PORT (${String(ingestPort)}) must differ from PORT (${String(port)})`,
    );
  }
  if (adminPort !== undefined && adminPort === ingestPort && adminPort > 0) {
    throw new Error(
      `STORM_STATS_ADMIN_PORT (${String(adminPort)}) must differ from STORM_STATS_INGEST_PORT (${String(ingestPort)})`,
    );
  }
}

export function loadStormStatsBootstrap(
  env: EnvMap = Bun.env,
): StormStatsBootstrap {
  const hostRaw = env["HOST"];
  const host =
    hostRaw !== undefined && hostRaw.trim().length > 0
      ? hostRaw.trim()
      : "0.0.0.0";
  const port = parsePort(env["PORT"], "PORT") ?? 7420;
  const adminPort = parsePort(
    env["STORM_STATS_ADMIN_PORT"],
    "STORM_STATS_ADMIN_PORT",
  );
  const ingestPort = parsePort(
    env["STORM_STATS_INGEST_PORT"],
    "STORM_STATS_INGEST_PORT",
  );
  assertDistinctPorts(port, adminPort, ingestPort);

  const rawToken = env["STORM_STATS_INGEST_TOKEN"];
  const ingestToken =
    rawToken !== undefined && rawToken.length > 0 ? rawToken : undefined;
  if (
    ingestPort !== undefined &&
    (ingestToken === undefined || ingestToken.length < MIN_INGEST_TOKEN_LENGTH)
  ) {
    throw new Error(
      `STORM_STATS_INGEST_TOKEN must be at least ${String(MIN_INGEST_TOKEN_LENGTH)} characters when STORM_STATS_INGEST_PORT is set`,
    );
  }

  const environmentRaw = env["ENVIRONMENT"];
  const environment =
    environmentRaw !== undefined && environmentRaw.trim().length > 0
      ? environmentRaw.trim()
      : "development";

  const dbPathRaw = env["STORM_STATS_DATABASE_PATH"];
  const defaultDbPath =
    environment === "production"
      ? "/var/lib/storm-stats/storm-stats.sqlite"
      : ":memory:";
  const databasePath =
    dbPathRaw !== undefined && dbPathRaw.trim().length > 0
      ? dbPathRaw.trim()
      : defaultDbPath;

  const modeRaw = env["FEATURE_FLAGS_MODE"];
  const featureFlagsMode =
    modeRaw === undefined || modeRaw.trim().length === 0
      ? "disabled"
      : FeatureFlagModeSchema.parse(modeRaw.trim());

  return {
    host,
    port,
    adminPort,
    ingestPort,
    ingestToken,
    databasePath,
    seedDemo: parseSeedDemo(env["STORM_STATS_SEED_DEMO"]),
    featureFlagsMode,
    environment,
  };
}

export type StormStatsBehaviorOptions = {
  readonly env?: EnvMap;
  readonly environmentStage?: string;
  readonly flagsDisabled?: boolean;
  readonly flagSource?: ConfigSource;
  readonly onSourceError?: (
    key: string,
    source: string,
    message: string,
  ) => void;
};

export function createStormStatsBehaviorResolver(
  options: StormStatsBehaviorOptions = {},
) {
  const env = options.env ?? Bun.env;
  const stage = options.environmentStage ?? "production";
  const resolvedFlagSource =
    options.flagsDisabled === true
      ? undefined
      : (options.flagSource ??
        createFlagConfigSource({
          targetingKey: "storm-stats",
          attributes: { stage },
          kinds: {
            ingestEnabled: "boolean",
            publicEnabled: "boolean",
          },
        }));

  return defineConfig({
    definition: STORM_STATS_BEHAVIOR_DEFINITION,
    sources: {
      ...(resolvedFlagSource === undefined ? {} : { flag: resolvedFlagSource }),
      env: createEnvSource(env),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        if (options.onSourceError !== undefined) {
          options.onSourceError(key, source, message);
          return;
        }
        console.warn(
          JSON.stringify({
            message: "storm_stats_config_source_error",
            key,
            source,
            error: message,
          }),
        );
      },
    },
  });
}

export type StormStatsBehaviorResolver = ReturnType<
  typeof createStormStatsBehaviorResolver
>;

/**
 * Verifies an `Authorization: Bearer <token>` header in constant time over
 * SHA-256 digests of the UTF-8 inputs so expected token length never leaks.
 */
export function verifyBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (authorizationHeader === undefined) {
    return false;
  }
  const match = /^Bearer\s+(\S+)$/u.exec(authorizationHeader.trim());
  const provided = match?.[1];
  if (provided === undefined) {
    return false;
  }
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256")
    .update(expectedToken, "utf8")
    .digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
