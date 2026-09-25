import path from "node:path";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import {
  startServer,
  stormSmokeConfig,
  type ServerInfo,
} from "./harness/server.ts";

declare module "vitest" {
  // Declaration merging with Vitest's ProvidedContext requires an interface
  // (eslint.config.ts allows it in this file only).
  export interface ProvidedContext {
    server: ServerInfo;
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
const ownedConfig = path.join(
  packageRoot,
  "server",
  "owned",
  "plugins",
  "TheStorm",
  "config.yml",
);

// CI (Buildkite on Kubernetes) has no Docker daemon: the pinned server image
// runs as a sidecar with the same plugins and smoke config, and the step
// passes its coordinates and shared latest.log path in here.
const ExternalServerSchema = z.object({
  STORM_E2E_HOST: z.string().min(1),
  STORM_E2E_GAME_PORT: z.coerce.number().int().positive(),
  STORM_E2E_RCON_PORT: z.coerce.number().int().positive(),
  STORM_E2E_RCON_PASSWORD: z.string().min(16),
  STORM_E2E_LOG_FILE: z.string().min(1),
});

export default async function setup(project: TestProject) {
  if (Bun.env["STORM_E2E_HOST"] !== undefined) {
    const env = ExternalServerSchema.parse(Bun.env);
    project.provide("server", {
      kind: "external",
      host: env.STORM_E2E_HOST,
      gamePort: env.STORM_E2E_GAME_PORT,
      rconPort: env.STORM_E2E_RCON_PORT,
      rconPassword: env.STORM_E2E_RCON_PASSWORD,
      logFile: env.STORM_E2E_LOG_FILE,
    });
    return;
  }
  if (!(await Bun.file(stormJar).exists())) {
    throw new Error(
      `${stormJar} is missing; build it first with: bunx turbo run build --filter=@shepherdjerred/the-storm`,
    );
  }
  const server = await startServer({
    cacheDir: path.join(packageRoot, ".cache", "e2e"),
    bootTimeoutMs: 180_000,
    warmCache: Bun.env["STORM_E2E_COLD"] !== "1",
    stormJar,
    stormConfig: stormSmokeConfig(await Bun.file(ownedConfig).text()),
  });
  if (server.info.kind === "container") {
    console.warn(
      `[e2e] Paper ${server.info.containerId.slice(0, 12)} ready in ${server.info.bootMs.toString()}ms`,
    );
  }
  project.provide("server", server.info);
  return server.stop;
}
