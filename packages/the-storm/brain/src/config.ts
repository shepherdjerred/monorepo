import { defineConfig } from "@shepherdjerred/config";
import { createFileSource } from "@shepherdjerred/config/sources/file.ts";
import type { ConfigSource } from "@shepherdjerred/config/source.ts";
import { z } from "zod";

const Hour = z.number().int().min(0).max(23);
const Port = z.number().int().min(1).max(65_535);
const definition = {
  enabled: {
    schema: z.boolean(),
    sources: ["flag", "file", "default"],
    default: false,
    names: { flag: "the-storm-companion-pilot-enabled" },
  },
  timeZone: {
    schema: z.string().min(1),
    sources: ["file", "default"],
    default: "America/Los_Angeles",
    names: { file: "timeZone" },
  },
  startHour: {
    schema: Hour,
    sources: ["file", "default"],
    default: 18,
    names: { file: "startHour" },
  },
  endHour: {
    schema: Hour,
    sources: ["file", "default"],
    default: 20,
    names: { file: "endHour" },
  },
  minecraftHost: {
    schema: z.string().min(1),
    sources: ["file", "default"],
    default: "127.0.0.1",
    names: { file: "minecraftHost" },
  },
  minecraftPort: {
    schema: Port,
    sources: ["file", "default"],
    default: 25_565,
    names: { file: "minecraftPort" },
  },
  rconHost: {
    schema: z.string().min(1),
    sources: ["file", "default"],
    default: "127.0.0.1",
    names: { file: "rconHost" },
  },
  rconPort: {
    schema: Port,
    sources: ["file", "default"],
    default: 25_575,
    names: { file: "rconPort" },
  },
  clientVersion: {
    schema: z.literal("26.1"),
    sources: ["file", "default"],
    default: "26.1",
    names: { file: "clientVersion" },
  },
  maxCompanions: {
    schema: z.literal(1),
    sources: ["file", "default"],
    default: 1,
    names: { file: "maxCompanions" },
  },
  botPlayerName: {
    schema: z.string(),
    sources: ["file", "default"],
    default: "",
    names: { file: "botPlayerName" },
  },
  llmEnabled: {
    schema: z.boolean(),
    sources: ["file", "default"],
    default: false,
    names: { file: "llmEnabled" },
  },
  llmModel: {
    schema: z.literal("gpt-6-luna"),
    sources: ["file", "default"],
    default: "gpt-6-luna",
    names: { file: "llmModel" },
  },
  monthlyBudgetUsd: {
    schema: z.literal(20),
    sources: ["file", "default"],
    default: 20,
    names: { file: "monthlyBudgetUsd" },
  },
} as const;

const ConfigSchema = z
  .strictObject({
    enabled: z.boolean(),
    timeZone: z.string().min(1),
    startHour: Hour,
    endHour: Hour,
    minecraftHost: z.string().min(1),
    minecraftPort: Port,
    rconHost: z.string().min(1),
    rconPort: Port,
    clientVersion: z.literal("26.1"),
    maxCompanions: z.literal(1),
    botPlayerName: z.string(),
    llmEnabled: z.boolean(),
    llmModel: z.literal("gpt-6-luna"),
    monthlyBudgetUsd: z.literal(20),
  })
  .refine(
    (value) => value.startHour < value.endHour,
    "window must end after it starts",
  )
  .refine(
    (value) => !value.enabled || /^\w{3,16}$/u.test(value.botPlayerName),
    "enabled pilot requires the exact Minecraft profile name",
  );

export type PilotConfig = z.infer<typeof ConfigSchema>;

export async function loadPilotConfig(
  path: string,
  flagSource?: ConfigSource,
): Promise<PilotConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`pilot configuration is missing: ${path}`);
  }
  ConfigSchema.parse(await file.json());
  const resolver = defineConfig({
    definition,
    sources: {
      file: await createFileSource({ path }),
      ...(flagSource === undefined ? {} : { flag: flagSource }),
    },
  });
  const entries = await Promise.all(
    resolver.keys.map(async (key) => [key, await resolver.value(key)] as const),
  );
  const config = ConfigSchema.parse(Object.fromEntries(entries));
  new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone });
  return config;
}

const BootstrapSchema = z.strictObject({
  MINECRAFT_BOT_EMAIL: z.email(),
  MINECRAFT_AUTH_CACHE_DIR: z.string().min(1),
  MINECRAFT_RCON_PASSWORD: z.string().min(1),
});

/** Credentials are read only after both pilot gates pass and are never logged. */
export function loadBootstrap(environment: NodeJS.ProcessEnv) {
  return BootstrapSchema.parse({
    MINECRAFT_BOT_EMAIL: environment["MINECRAFT_BOT_EMAIL"],
    MINECRAFT_AUTH_CACHE_DIR: environment["MINECRAFT_AUTH_CACHE_DIR"],
    MINECRAFT_RCON_PASSWORD: environment["MINECRAFT_RCON_PASSWORD"],
  });
}
