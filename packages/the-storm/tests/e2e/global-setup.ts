import { randomBytes } from "node:crypto";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { startFakeBrain } from "./harness/fake-brain.ts";
import {
  serverLogs,
  startServer,
  stormTestConfig,
  type ServerInfo,
} from "./harness/server.ts";

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
const mechanicsE2eJar = path.join(
  packageRoot,
  "plugin",
  "modules",
  "mechanics",
  "build",
  "libs",
  "TheStormMechanicsE2E.jar",
);
const ownedConfigDir = path.join(
  packageRoot,
  "server",
  "owned",
  "plugins",
  "TheStorm",
);
const ownedConfig = path.join(ownedConfigDir, "config.yml");
const mechanicsConfig = path.join(ownedConfigDir, "mechanics.yml");

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

export default async function setup(project: TestProject) {
  const full = Bun.env["STORM_E2E_FULL"] === "1";
  // The agent refuses to start without its token, so both local and sidecar
  // runs use the same strict fake brain contract.
  const external = Bun.env["STORM_E2E_HOST"] !== undefined;
  if (external) {
    const env = ExternalServerSchema.parse(Bun.env);
    project.provide("server", {
      kind: "external",
      host: env.STORM_E2E_HOST,
      gamePort: env.STORM_E2E_GAME_PORT,
      rconPort: env.STORM_E2E_RCON_PORT,
      rconPassword: env.STORM_E2E_RCON_PASSWORD,
      logFile: env.STORM_E2E_LOG_FILE,
    });
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
      ...(full ? ["full"] : []),
    ),
    bootTimeoutMs: 180_000,
    warmCache: Bun.env["STORM_E2E_COLD"] !== "1",
    stormJar,
    // Mechanics runs once through its test plugin, which owns the Paper world
    // fixture; enabling the production module would register duplicate listeners.
    stormConfig: full
      ? await Bun.file(ownedConfig).text()
      : stormTestConfig(await Bun.file(ownedConfig).text(), [
          "economy",
          "chat",
          "tracks",
          "towns",
          "tickets",
          "agent",
        ]),
    ...(full
      ? {
          fixturesJar: path.join(
            packageRoot,
            "plugin/dist/build/libs/TheStormFixtures.jar",
          ),
        }
      : {
          mechanicsE2eJar,
          mechanicsConfig: await Bun.file(mechanicsConfig).text(),
        }),
    ownedConfigDir,
    brain: { baseUrl: brainBaseUrl, token: brainToken },
    sweep: {
      intervalMinutes: 1,
      redriveAfterMinutes: 0,
      redriveBackoffMinutes: 0,
      slaAfterMinutes: 10_080,
    },
    agent: { mode: full ? "active" : "shadow", reviewSamplePercent: 100 },
  });
  if (server.info.kind === "container") {
    console.warn(
      `[e2e] Paper ${server.info.containerId.slice(0, 12)} ready in ${server.info.bootMs.toString()}ms`,
    );
  }
  project.provide("server", server.info);
  project.provide("brain", { port: brain.port });
  return async () => {
    try {
      // Preserve the complete server output before removing the disposable
      // container. This is the only useful evidence for boot and disconnect
      // failures in local E2E runs.
      await Bun.write(
        path.join(packageRoot, ".cache", "e2e", "latest-server.log"),
        await serverLogs(server.info),
      );
    } finally {
      await server.stop();
      await brain.stop();
    }
  };
}
