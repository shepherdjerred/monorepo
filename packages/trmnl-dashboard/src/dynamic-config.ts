import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";
import { featureFlagMetrics } from "./feature-flag-metrics.ts";
import { parseEntities, type AppConfig } from "./config.ts";

const DEFINITION = {
  presenceEntities: {
    schema: z.string().transform(parseEntities),
    sources: ["flag", "default"],
    default: "person.jerred:Jerred,person.shuxin:Shuxin,person.fengyu:Fengyu",
    names: { flag: "trmnl-ha-presence-entities" },
  },
  securityEntities: {
    schema: z.string().transform(parseEntities),
    sources: ["flag", "default"],
    default:
      "lock.front_door:Front Door,binary_sensor.sensor_motion_detection:Sensor Motion detection,binary_sensor.sensor_motion_detection_2:Sensor Motion detection,binary_sensor.front_door_motion:Front Door Motion",
    names: { flag: "trmnl-ha-security-entities" },
  },
  climateEntities: {
    schema: z.string().transform(parseEntities),
    sources: ["flag", "default"],
    default:
      "climate.bedroom:Bedroom,climate.living_room:Living Room,climate.master_bathroom:Master Bathroom,climate.guest_bathroom:Guest Bathroom,climate.office:Office,climate.guest_room:Guest Room",
    names: { flag: "trmnl-ha-climate-entities" },
  },
  petDashboardEnabled: {
    schema: z.boolean(),
    sources: ["flag", "default"],
    default: false,
    names: { flag: "pet-dashboard-enabled" },
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
          petDashboardEnabled: "boolean",
          presenceEntities: "string",
          securityEntities: "string",
          climateEntities: "string",
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

export async function petDashboardEnabled(): Promise<boolean> {
  if (resolver === undefined) {
    throw new Error(
      "dynamic config read before initializeDynamicConfig(); call it during startup",
    );
  }
  return resolver.value("petDashboardEnabled", {
    targetingKey: "trmnl-dashboard",
  });
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
