import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  flagValueKind,
  flagValueSchema,
} from "@shepherdjerred/feature-flags/flag-value-schemas.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { featureFlagMetrics } from "./feature-flag-metrics.ts";
import { parseEntities, type AppConfig } from "./config.ts";

const DEFINITION = {
  presenceEntities: {
    schema: flagValueSchema("trmnl-ha-presence-entities").transform(
      parseEntities,
    ),
    sources: ["flag", "default"],
    default: "person.jerred:Jerred,person.shuxin:Shuxin,person.fengyu:Fengyu",
    names: { flag: "trmnl-ha-presence-entities" },
  },
  securityEntities: {
    schema: flagValueSchema("trmnl-ha-security-entities").transform(
      parseEntities,
    ),
    sources: ["flag", "default"],
    default:
      "lock.front_door:Front Door,binary_sensor.sensor_motion_detection:Sensor Motion detection,binary_sensor.sensor_motion_detection_2:Sensor Motion detection,binary_sensor.front_door_motion:Front Door Motion",
    names: { flag: "trmnl-ha-security-entities" },
  },
  climateEntities: {
    schema: flagValueSchema("trmnl-ha-climate-entities").transform(
      parseEntities,
    ),
    sources: ["flag", "default"],
    default:
      "climate.bedroom:Bedroom,climate.living_room:Living Room,climate.master_bathroom:Master Bathroom,climate.guest_bathroom:Guest Bathroom,climate.office:Office,climate.guest_room:Guest Room",
    names: { flag: "trmnl-ha-climate-entities" },
  },
} as const;

let resolver: ReturnType<typeof createResolver> | undefined;

function createResolver() {
  return defineConfig({
    definition: DEFINITION,
    sources: {
      flag: createFlagConfigSource({
        targetingKey: "trmnl-dashboard",
        kinds: {
          presenceEntities: flagValueKind("trmnl-ha-presence-entities"),
          securityEntities: flagValueKind("trmnl-ha-security-entities"),
          climateEntities: flagValueKind("trmnl-ha-climate-entities"),
        },
      }),
    },
    hooks: {
      onSourceError: (key, source, message) => {
        console.warn(`[Config] ${key} ${source}: ${message}`);
      },
    },
  });
}

export async function initializeDynamicConfig(
  options: {
    environment?: InitFeatureFlagsOptions["environment"];
    provider?: InitFeatureFlagsOptions["provider"];
  } = {},
): Promise<void> {
  await initFeatureFlags({
    ...(options.environment === undefined
      ? {}
      : { environment: options.environment }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    metrics: featureFlagMetrics.recorder,
    onInitializationFailure: (message) => {
      console.warn(`[Config] ${message}`);
    },
  });
  resolver = createResolver();
}

/** Resolve entity selection for each home payload, using the existing client. */
export async function homeDashboardConfig(
  config: AppConfig,
): Promise<AppConfig> {
  if (resolver === undefined) {
    throw new Error("home config read before initializeDynamicConfig()");
  }
  const [presence, security, climate] = await Promise.all([
    resolver.value("presenceEntities"),
    resolver.value("securityEntities"),
    resolver.value("climateEntities"),
  ]);
  return {
    ...config,
    homeAssistant: { ...config.homeAssistant, presence, security, climate },
  };
}

export async function shutdownDynamicConfig(): Promise<void> {
  resolver = undefined;
  await shutdownFeatureFlags();
}
