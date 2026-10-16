import { z } from "zod";
import path from "node:path";
import { defineConfig } from "@shepherdjerred/config";
import { createFileSource } from "@shepherdjerred/config/sources/file.ts";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import type { GameId } from "@arcade/common/catalog.ts";
import type { ResolverHooks } from "@shepherdjerred/config/resolver.ts";
import { RuntimeSettingsSchema, runtimeDefaults } from "./runtime-config.ts";

const behavior = ["file", "default"] as const;
const rollout = ["flag", "file", "default"] as const;

export const configDefinition = {
  // Boot-wired ownership: enable through GitOps only after legacy bots stop.
  controllerActive: { schema: z.boolean(), sources: behavior, default: false },
  enabled: {
    schema: z.boolean(),
    sources: rollout,
    names: { flag: "arcade_enabled" },
    targeted: true,
    default: false,
  },
  mkwiiEnabled: {
    schema: z.boolean(),
    sources: rollout,
    names: { flag: "arcade_mkwii_enabled" },
    targeted: true,
    default: false,
  },
  meleeEnabled: {
    schema: z.boolean(),
    sources: rollout,
    names: { flag: "arcade_melee_enabled" },
    targeted: true,
    default: false,
  },
  brawlEnabled: {
    schema: z.boolean(),
    sources: rollout,
    names: { flag: "arcade_brawl_enabled" },
    targeted: true,
    default: false,
  },
  maxSessions: {
    schema: z.number().int().min(1).max(2),
    sources: behavior,
    default: 2,
  },
  maxHeavySessions: {
    schema: z.number().int().min(0).max(1),
    sources: behavior,
    default: 1,
  },
  port: {
    schema: z.number().int().min(1024).max(49_151),
    sources: behavior,
    default: 8081,
  },
  stateRoot: {
    schema: z.string().min(1),
    sources: behavior,
    default: "/data/saves",
  },
  databasePath: {
    schema: z.string().min(1),
    sources: behavior,
    default: "/data/arcade.db",
  },
  webAssets: {
    schema: z.string().min(1),
    sources: behavior,
    default: path.resolve(import.meta.dirname, "../../frontend/dist"),
  },
  streamVideo: {
    schema: RuntimeSettingsSchema.shape.streamVideo,
    sources: behavior,
    default: runtimeDefaults.streamVideo,
  },
  emeraldStreamVideo: {
    schema: RuntimeSettingsSchema.shape.emeraldStreamVideo,
    sources: behavior,
    default: runtimeDefaults.emeraldStreamVideo,
  },
  driverFeed: {
    schema: RuntimeSettingsSchema.shape.driverFeed,
    sources: behavior,
    default: runtimeDefaults.driverFeed,
  },
  mk64OutputFps: {
    schema: RuntimeSettingsSchema.shape.mk64OutputFps,
    sources: behavior,
    default: runtimeDefaults.mk64OutputFps,
  },
  mk64OverlayEnabled: {
    schema: RuntimeSettingsSchema.shape.mk64OverlayEnabled,
    sources: behavior,
    default: runtimeDefaults.mk64OverlayEnabled,
  },
  mk64PollEveryNFrames: {
    schema: RuntimeSettingsSchema.shape.mk64PollEveryNFrames,
    sources: behavior,
    default: runtimeDefaults.mk64PollEveryNFrames,
  },
  emeraldNotifications: {
    schema: RuntimeSettingsSchema.shape.emeraldNotifications,
    sources: behavior,
    default: runtimeDefaults.emeraldNotifications,
  },
  emeraldCommands: {
    schema: RuntimeSettingsSchema.shape.emeraldCommands,
    sources: behavior,
    default: runtimeDefaults.emeraldCommands,
  },
  emeraldGoal: {
    schema: RuntimeSettingsSchema.shape.emeraldGoal,
    sources: behavior,
    default: runtimeDefaults.emeraldGoal,
  },
  runtimeAssets: {
    schema: z.string().min(1),
    sources: behavior,
    default: "/data/assets",
  },
  chromium: {
    schema: z.string().min(1),
    sources: behavior,
    default: "/usr/bin/chromium",
  },
  dolphin: {
    schema: z.string().min(1),
    sources: behavior,
    default: "/opt/dolphin/bin/dolphin-emu-nogui",
  },
  runtimePort: {
    schema: z.number().int().min(1024).max(49_151),
    sources: behavior,
    default: 9082,
  },
  runtimeStartupTimeoutMs: {
    schema: z.number().int().min(10_000).max(600_000),
    sources: behavior,
    default: 180_000,
  },
  goalGuildIds: {
    schema: z.array(z.string().regex(/^\d+$/)),
    sources: behavior,
    default: [],
  },
} as const;

export async function loadConfig(
  filePath: string,
  environment: string,
  hooks: ResolverHooks = {},
) {
  const file = await createFileSource({ path: filePath });
  return defineConfig({
    definition: configDefinition,
    hooks,
    sources: {
      // Top-level names are typed keys; TOML tables hold structured settings.
      file: {
        ...file,
        get: (names) => file.get({ ...names, file: names.key }),
      },
      flag: createFlagConfigSource({
        targetingKey: "arcade",
        attributes: { environment },
        kinds: {
          enabled: "boolean",
          mkwiiEnabled: "boolean",
          meleeEnabled: "boolean",
          brawlEnabled: "boolean",
        },
      }),
    },
  });
}

export async function readRuntimeSettings(
  config: Awaited<ReturnType<typeof loadConfig>>,
) {
  const keys = [
    "streamVideo",
    "emeraldStreamVideo",
    "driverFeed",
    "mk64OutputFps",
    "mk64OverlayEnabled",
    "mk64PollEveryNFrames",
    "emeraldNotifications",
    "emeraldCommands",
    "emeraldGoal",
  ] as const;
  return RuntimeSettingsSchema.parse(
    Object.fromEntries(
      await Promise.all(
        keys.map(async (key) => [key, await config.value(key)]),
      ),
    ),
  );
}

export async function gameEnabled(
  config: Awaited<ReturnType<typeof loadConfig>>,
  gameId: GameId,
  guildId: string,
): Promise<boolean> {
  const context = { targetingKey: guildId };
  if (!(await config.value("enabled", context))) return false;
  const keys = {
    mk64: null,
    emerald: null,
    mkwii: "mkwiiEnabled",
    melee: "meleeEnabled",
    brawl: "brawlEnabled",
  } as const;
  const key = keys[gameId];
  return key === null || config.value(key, context);
}
