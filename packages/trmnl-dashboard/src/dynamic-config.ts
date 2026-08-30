import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
  type InitFeatureFlagsOptions,
} from "@shepherdjerred/feature-flags";

const DEFINITION = {
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
        kinds: { petDashboardEnabled: "boolean" },
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

export async function shutdownDynamicConfig(): Promise<void> {
  resolver = undefined;
  await shutdownFeatureFlags();
}
