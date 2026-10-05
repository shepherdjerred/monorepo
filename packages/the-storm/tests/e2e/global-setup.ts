import { randomBytes } from "node:crypto";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { startFakeBrain } from "./harness/fake-brain.ts";
import {
  e2eProfile,
  gameplayFixtures,
  loadResources,
} from "./gameplay-fixtures.ts";
import { rwfRecordingSalt } from "./harness/rwf-settings.ts";
import { serverLogs } from "@shepherdjerred/mc-harness/providers/docker/docker-cli.ts";
import { startServer, type ServerInfo } from "./harness/server.ts";

declare module "vitest" {
  // Declaration merging with Vitest's ProvidedContext requires an interface.
  export interface ProvidedContext {
    server: ServerInfo;
    brain: { port: number };
  }
}

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const stormJar = path.join(
  packageRoot,
  "plugin",
  "dist",
  "build",
  "libs",
  "TheStorm.jar",
);
const ownedConfigDir = path.join(
  packageRoot,
  "server",
  "owned",
  "plugins",
  "TheStorm",
);

const ExternalServerSchema = z.object({
  STORM_E2E_HOST: z.string().min(1),
  STORM_E2E_GAME_PORT: z.coerce.number().int().positive(),
  STORM_E2E_RCON_PORT: z.coerce.number().int().positive(),
  STORM_E2E_RCON_PASSWORD: z.string().min(16),
  STORM_E2E_LOG_FILE: z.string().min(1),
  STORM_E2E_BRAIN_HOST: z.string().min(1),
  STORM_E2E_BRAIN_PORT: z.coerce.number().int().positive(),
  STORM_E2E_BRAIN_TOKEN: z.string().min(1),
});

async function arenaAdmission(server: ServerInfo): Promise<void> {
  // An idle runner can report "open" before asynchronous map validation finishes.
  for (let attempt = 0; attempt < 120; attempt++) {
    const logs = await serverLogs(server);
    if (logs.includes("Prepared arena maps; admission is open")) return;
    await Bun.sleep(500);
  }
  throw new Error("The authored arenas did not open after Paper startup");
}

export default async function setup(project: TestProject) {
  const profile = e2eProfile();
  // The load profile is full plus the load-test switch and production limits.
  const full = profile !== "e2e";
  // The agent refuses to start without its token, so both local and sidecar
  // runs use the same strict fake brain contract.
  const external = Bun.env["STORM_E2E_HOST"] !== undefined;
  if (external) {
    const env = ExternalServerSchema.parse(Bun.env);
    const server: ServerInfo = {
      kind: "external",
      host: env.STORM_E2E_HOST,
      gamePort: env.STORM_E2E_GAME_PORT,
      rconPort: env.STORM_E2E_RCON_PORT,
      rconPassword: env.STORM_E2E_RCON_PASSWORD,
      logFile: env.STORM_E2E_LOG_FILE,
    };
    if (full) await arenaAdmission(server);
    project.provide("server", server);
    project.provide("brain", { port: env.STORM_E2E_BRAIN_PORT });
    return;
  }
  const brainToken = randomBytes(24).toString("hex");
  const brain = startFakeBrain(brainToken);
  const brainBaseUrl = `http://host.docker.internal:${brain.port.toString()}`;
  if (!(await Bun.file(stormJar).exists())) {
    await brain.stop();
    throw new Error(
      `${stormJar} is missing; build it first with: bunx turbo run build --filter=@shepherdjerred/the-storm`,
    );
  }

  const server = await startServer({
    cacheDir: path.join(
      packageRoot,
      ".cache",
      "e2e",
      ...(profile === "e2e" ? [] : [profile]),
    ),
    bootTimeoutMs: 180_000,
    warmCache: Bun.env["STORM_E2E_COLD"] !== "1",
    stormJar,
    ...(await gameplayFixtures(packageRoot, profile)),
    ...(profile === "load" ? { resources: loadResources() } : {}),
    ownedConfigDir,
    env: {
      // The managed-flag gates (rwf join here; crier and merchant in the full
      // suite) evaluate against the fake brain's Flipt double.
      FLIPT_URL: brainBaseUrl,
      FLIPT_ENVIRONMENT: "prod",
      RWF_RECORDING_SALT: rwfRecordingSalt,
      // The load test reads spark's tick percentiles and the long bot
      // overview from the console, which RCON cannot return.
      ...(profile === "load" ? { CREATE_CONSOLE_IN_PIPE: "true" } : {}),
      // Deliberately malformed test token: JDA rejects it locally, without
      // authenticating to or posting in a real Discord server.
      ...(full
        ? {
            DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
            DISCORD_CHANNEL_ID: "1",
          }
        : {}),
    },
    brain: { baseUrl: brainBaseUrl, token: brainToken },
    sweep: {
      intervalMinutes: 1,
      redriveAfterMinutes: 0,
      redriveBackoffMinutes: 0,
      slaAfterMinutes: 10_080,
    },
    agent: { mode: full ? "active" : "shadow", reviewSamplePercent: 100 },
    ...(Bun.env["STORM_E2E_WORLD_DIR"] === undefined
      ? {}
      : {
          worldDir: z.string().min(1).parse(Bun.env["STORM_E2E_WORLD_DIR"]),
        }),
    ...(Bun.env["STORM_E2E_EXPORT_WORLD_DIR"] === undefined
      ? {}
      : {
          exportWorldDir: z
            .string()
            .min(1)
            .parse(Bun.env["STORM_E2E_EXPORT_WORLD_DIR"]),
        }),
  });
  if (server.info.kind === "container") {
    console.warn(
      `[e2e] Paper ${server.info.containerId.slice(0, 12)} ready in ${server.info.bootMs.toString()}ms`,
    );
  }
  try {
    if (full) await arenaAdmission(server.info);
  } catch (error) {
    await server.stop();
    await brain.stop();
    throw error;
  }
  project.provide("server", server.info);
  project.provide("brain", { port: brain.port });
  return async () => {
    try {
      // Preserve the complete server output before removing the disposable
      // container. This is the only useful evidence for boot and disconnect
      // failures in local E2E runs.
      await Bun.write(
        path.join(
          packageRoot,
          ".cache",
          "e2e",
          ...(full ? ["full"] : []),
          "latest-server.log",
        ),
        await serverLogs(server.info),
      );
    } finally {
      await server.stop();
      await brain.stop();
    }
  };
}
