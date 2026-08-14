import { access, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import {
  ScenarioEnvironment,
  StreamingSecretRedactor,
  reservePort,
} from "@tasknotes/e2e";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const seedVault = path.join(
  repositoryRoot,
  "packages",
  "tasks-for-obsidian",
  "e2e",
  "fixtures",
  "seed-vault",
);
const serverDirectory = path.join(
  repositoryRoot,
  "packages",
  "tasknotes-server",
);

describe("shared real-server environment", () => {
  test("redacts secrets split across byte chunks", () => {
    const redactor = new StreamingSecretRedactor(["top-secret"]);
    const encoder = new TextEncoder();

    const output =
      redactor.push(encoder.encode("prefix top-")) +
      redactor.push(encoder.encode("secret suffix")) +
      redactor.finish();

    expect(output).toBe("prefix [REDACTED] suffix");
    expect(output).not.toContain("top-secret");
  });

  test("rejects deterministic server and proxy port collisions without starting processes", async () => {
    const port = await reservePort();
    await expect(
      ScenarioEnvironment.start({
        scenarioId: "port-collision",
        seedVault,
        tasknotesServerDirectory: serverDirectory,
        serverPort: port,
        proxyPort: port,
      }),
    ).rejects.toThrow("distinct ports");
  });

  test("retains explicitly requested artifacts after successful cleanup", async () => {
    const environment = await ScenarioEnvironment.start({
      scenarioId: "retained-artifacts",
      seedVault,
      tasknotesServerDirectory: serverDirectory,
    });
    const scenarioDirectory = environment.scenarioDirectory;
    environment.retain();
    await environment.dispose(true);

    await expect(access(scenarioDirectory)).resolves.toBeNull();
    await rm(scenarioDirectory, { recursive: true });
  }, 60_000);

  test("provisions an authenticated server, deterministic chaos, and a seeded vault", async () => {
    const environment = await ScenarioEnvironment.start({
      scenarioId: "shared-smoke",
      seedVault,
      tasknotesServerDirectory: serverDirectory,
    });
    let passed = false;
    const scenarioDirectory = environment.scenarioDirectory;
    try {
      const unauthenticated = await fetch(`${environment.proxyUrl}/api/tasks`);
      expect(unauthenticated.status).toBe(401);

      const authenticated = await fetch(`${environment.proxyUrl}/api/tasks`, {
        headers: { authorization: `Bearer ${environment.authToken}` },
      });
      expect(authenticated.status).toBe(200);

      await environment.chaos.failNext({
        method: "GET",
        path: "/api/tasks",
        status: 503,
        body: '{"error":"planned"}',
      });
      const injected = await fetch(`${environment.proxyUrl}/api/tasks`, {
        headers: { authorization: `Bearer ${environment.authToken}` },
      });
      expect(injected.status).toBe(503);
      expect(await injected.text()).toBe('{"error":"planned"}');

      await environment.chaos.offline();
      await expect(
        fetch(`${environment.proxyUrl}/api/health`),
      ).rejects.toBeDefined();
      await environment.chaos.online();
      const chaosStatus = await environment.chaos.status();
      expect(chaosStatus.offline).toBe(false);

      const vault = await environment.readMarkdownVault();
      expect(vault.size).toBeGreaterThan(0);
      passed = true;
    } finally {
      await environment.dispose(passed);
    }
    await expect(access(scenarioDirectory)).rejects.toBeDefined();
  }, 60_000);
});
