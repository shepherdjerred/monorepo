import { randomBytes } from "node:crypto";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { z } from "zod";
import { startFakeBrain } from "./harness/fake-brain.ts";
import {
  startServer,
  stormTestConfig,
  type ServerInfo,
} from "./harness/server.ts";
import {
  ownedConfig,
  ownedConfigDir,
  packageRoot,
  stormJar,
} from "./harness/paths.ts";

declare module "vitest" {
  // Declaration merging with Vitest's ProvidedContext requires an interface
  // (eslint.config.ts allows it in this file only).
  export interface ProvidedContext {
    server: ServerInfo;
    brain: { port: number };
  }
}

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
  // The agent module refuses to start without a brain token, so the fake
  // brain runs in both modes; the sidecar pod shares the runner's loopback.
  // External coordinates are fixed by contract: the CI step points the
  // sidecar's agent.yml at 127.0.0.1:18081 and injects the same token.
  const external = Bun.env["STORM_E2E_HOST"] !== undefined;
  const brainToken = external
    ? (Bun.env["STORM_E2E_BRAIN_TOKEN"] ?? "e2e-fake-brain")
    : randomBytes(24).toString("hex");
  const brain = startFakeBrain(
    brainToken,
    external ? Number(Bun.env["STORM_E2E_BRAIN_PORT"] ?? 18_081) : 0,
  );
  const brainHost = external ? "127.0.0.1" : "host.docker.internal";
  const brainBaseUrl = `http://${brainHost}:${brain.port.toString()}`;
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
    // The sidecar's agent.yml and environment come from the CI step, which
    // must point at this run's fake brain out of band.
    console.warn(
      `[e2e] fake brain at ${brainBaseUrl}; sidecar STORM_BRAIN_BEARER_TOKEN must match`,
    );
    project.provide("brain", { port: brain.port });
    return brain.stop;
  }
  if (!(await Bun.file(stormJar).exists())) {
    await brain.stop();
    throw new Error(
      `${stormJar} is missing; build it first with: bunx turbo run build --filter=@shepherdjerred/the-storm`,
    );
  }
  const server = await startServer({
    cacheDir: path.join(packageRoot, ".cache", "e2e"),
    bootTimeoutMs: 180_000,
    warmCache: Bun.env["STORM_E2E_COLD"] !== "1",
    stormJar,
    stormConfig: stormTestConfig(await Bun.file(ownedConfig).text(), [
      "tickets",
      "agent",
      "chat",
    ]),
    ownedConfigDir,
    brain: { baseUrl: brainBaseUrl, token: brainToken },
    sweep: {
      intervalMinutes: 1,
      redriveAfterMinutes: 0,
      redriveBackoffMinutes: 0,
      slaAfterMinutes: 10_080,
    },
    // Shadow mode watches without acting; full sampling makes every row reviewable.
    agent: { mode: "shadow", reviewSamplePercent: 100 },
  });
  if (server.info.kind === "container") {
    console.warn(
      `[e2e] Paper ${server.info.containerId.slice(0, 12)} ready in ${server.info.bootMs.toString()}ms`,
    );
  }
  project.provide("server", server.info);
  project.provide("brain", { port: brain.port });
  return async () => {
    await server.stop();
    await brain.stop();
  };
}
