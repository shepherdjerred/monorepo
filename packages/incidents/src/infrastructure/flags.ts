/**
 * Incidents behavior flags, in Hub's `alert-dashboard` namespace and read from
 * the `alert-dashboard/prod` deployment through Hub's process-wide flag client.
 * Every value is resolved per call, so a flag flip applies without a restart.
 */
import { defineConfig } from "@shepherdjerred/config";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { z } from "zod";
import type { IncidentsSettings } from "#domain/model.ts";

export type IncidentsFlagReader = {
  readonly read: () => Promise<IncidentsSettings>;
};

/** Hub's evaluation entity (the bucketing key it already uses). */
const TARGETING_KEY = "alert-dashboard";

export const INCIDENTS_FLAG_KEYS = {
  enabled: "alert-dashboard-incidents-enabled",
  autoOpenAlertmanager:
    "alert-dashboard-incidents-auto-open-alertmanager-enabled",
  autoOpenMainCi: "alert-dashboard-incidents-auto-open-main-ci-enabled",
  takeoverGraceSeconds: "alert-dashboard-incidents-takeover-grace-seconds",
  dispatchLeaseSeconds: "alert-dashboard-incidents-dispatch-lease-seconds",
  takeoverSpawnEnabled: "alert-dashboard-incidents-takeover-spawn-enabled",
  takeoverProvider: "alert-dashboard-incidents-takeover-provider",
} as const satisfies Record<keyof IncidentsSettings, string>;

export const DEFAULT_INCIDENTS_SETTINGS: IncidentsSettings = {
  enabled: managedBooleanDefault(INCIDENTS_FLAG_KEYS.enabled),
  autoOpenAlertmanager: managedBooleanDefault(
    INCIDENTS_FLAG_KEYS.autoOpenAlertmanager,
  ),
  autoOpenMainCi: managedBooleanDefault(INCIDENTS_FLAG_KEYS.autoOpenMainCi),
  takeoverGraceSeconds: 600,
  dispatchLeaseSeconds: 600,
  takeoverSpawnEnabled: managedBooleanDefault(
    INCIDENTS_FLAG_KEYS.takeoverSpawnEnabled,
  ),
  takeoverProvider: "claude-code",
};

const FLAG_ONLY = ["flag", "default"] as const;
const BooleanSchema = z.boolean();
const SecondsSchema = z.number().int().min(0).max(86_400);
const ProviderSchema = z.string().min(1).max(100);
const D = DEFAULT_INCIDENTS_SETTINGS;
const K = INCIDENTS_FLAG_KEYS;

const DEFINITION = {
  enabled: {
    schema: BooleanSchema,
    sources: FLAG_ONLY,
    default: D.enabled,
    names: { flag: K.enabled },
  },
  autoOpenAlertmanager: {
    schema: BooleanSchema,
    sources: FLAG_ONLY,
    default: D.autoOpenAlertmanager,
    names: { flag: K.autoOpenAlertmanager },
  },
  autoOpenMainCi: {
    schema: BooleanSchema,
    sources: FLAG_ONLY,
    default: D.autoOpenMainCi,
    names: { flag: K.autoOpenMainCi },
  },
  takeoverGraceSeconds: {
    schema: SecondsSchema,
    sources: FLAG_ONLY,
    default: D.takeoverGraceSeconds,
    names: { flag: K.takeoverGraceSeconds },
  },
  dispatchLeaseSeconds: {
    schema: SecondsSchema,
    sources: FLAG_ONLY,
    default: D.dispatchLeaseSeconds,
    names: { flag: K.dispatchLeaseSeconds },
  },
  takeoverSpawnEnabled: {
    schema: BooleanSchema,
    sources: FLAG_ONLY,
    default: D.takeoverSpawnEnabled,
    names: { flag: K.takeoverSpawnEnabled },
  },
  takeoverProvider: {
    schema: ProviderSchema,
    sources: FLAG_ONLY,
    default: D.takeoverProvider,
    names: { flag: K.takeoverProvider },
  },
} as const;

/** Hub's flag source for these keys. */
export function incidentsFlagSource(): ConfigSource {
  return createFlagConfigSource({
    targetingKey: TARGETING_KEY,
    kinds: {
      enabled: "boolean",
      autoOpenAlertmanager: "boolean",
      autoOpenMainCi: "boolean",
      takeoverGraceSeconds: "number",
      dispatchLeaseSeconds: "number",
      takeoverSpawnEnabled: "boolean",
      takeoverProvider: "string",
    },
  });
}

/**
 * Resolve every incidents setting per call. A failing flag source falls back
 * to the inventory default (and warns); an invalid present value throws.
 */
export function createIncidentsFlagReader(
  source: ConfigSource = incidentsFlagSource(),
): IncidentsFlagReader {
  const resolver = defineConfig({
    definition: DEFINITION,
    sources: { flag: source },
    hooks: {
      onSourceError: (key, sourceName, message) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "incidents_config_source_error",
            key,
            source: sourceName,
            error: message,
          }),
        );
      },
    },
  });
  return {
    read: async () => {
      const [
        enabled,
        autoOpenAlertmanager,
        autoOpenMainCi,
        takeoverGraceSeconds,
        dispatchLeaseSeconds,
        takeoverSpawnEnabled,
        takeoverProvider,
      ] = await Promise.all([
        resolver.value("enabled"),
        resolver.value("autoOpenAlertmanager"),
        resolver.value("autoOpenMainCi"),
        resolver.value("takeoverGraceSeconds"),
        resolver.value("dispatchLeaseSeconds"),
        resolver.value("takeoverSpawnEnabled"),
        resolver.value("takeoverProvider"),
      ]);
      return {
        enabled,
        autoOpenAlertmanager,
        autoOpenMainCi,
        takeoverGraceSeconds,
        dispatchLeaseSeconds,
        takeoverSpawnEnabled,
        takeoverProvider,
      };
    },
  };
}

/** Fixed settings for tests and fixture mode; unspecified keys use the inventory defaults. */
export function staticIncidentsFlags(
  overrides: Partial<IncidentsSettings> = {},
): IncidentsFlagReader {
  const settings = { ...DEFAULT_INCIDENTS_SETTINGS, ...overrides };
  return { read: () => Promise.resolve(settings) };
}
