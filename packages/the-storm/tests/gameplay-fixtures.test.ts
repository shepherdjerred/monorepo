import { afterEach, describe, expect, it, vi } from "vitest";
import { fullResources, profileResources } from "./e2e/gameplay-fixtures.ts";
import { arenaAdmission } from "./e2e/global-setup.ts";
import type { ServerInfo } from "./e2e/harness/server.ts";

const fakeServer: ServerInfo = {
  kind: "container",
  containerId: "0123456789abcdef",
  bootMs: 1200,
  host: "127.0.0.1",
  gamePort: 25_565,
  rconPort: 25_575,
  rconPassword: "r".repeat(32),
};

describe("gameplay profile resources", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allocates an 8G heap and 10g container limit for full without capping workstation CPUs", () => {
    expect(fullResources()).toEqual({
      heap: "8G",
      memoryLimit: "10g",
    });
    expect(profileResources("full")).toEqual({
      heap: "8G",
      memoryLimit: "10g",
    });
    expect(profileResources("e2e")).toBeUndefined();
  });

  it("routes load and capacity profiles through their measured CPU and memory budgets", () => {
    vi.stubEnv("STORM_E2E_LOAD_CPUS", "6");
    vi.stubEnv("STORM_CAPACITY_CPUS", "8");
    expect(profileResources("load")).toEqual({
      cpus: 6,
      heap: "8G",
      memoryLimit: "10g",
    });
    expect(profileResources("capacity")).toEqual({
      cpus: 8,
      heap: "8G",
      memoryLimit: "10g",
    });
  });
});

describe("arenaAdmission", () => {
  it("resolves once arena maps report open admission", async () => {
    let polls = 0;
    const logs = [
      "[Server thread/INFO]: Preparing spawn area",
      "[Server thread/INFO]: [TheStorm] Prepared arena maps; admission is open",
    ];
    await expect(
      arenaAdmission(fakeServer, {
        readLogs: () =>
          Promise.resolve(logs[Math.min(polls++, logs.length - 1)] ?? ""),
        sleep: () => Promise.resolve(),
        maxAttempts: 5,
      }),
    ).resolves.toBeUndefined();
    expect(polls).toBe(2);
  });

  it("fails fast instead of polling for 60s when arena preparation logs a fatal error", async () => {
    let polls = 0;
    let sleeps = 0;
    await expect(
      arenaAdmission(fakeServer, {
        readLogs: () => {
          polls++;
          return Promise.resolve(
            "[Server thread/ERROR]: [TheStorm] Could not prepare arenas; admission is disabled\njava.lang.OutOfMemoryError: Java heap space",
          );
        },
        sleep: () => {
          sleeps++;
          return Promise.resolve();
        },
        maxAttempts: 120,
      }),
    ).rejects.toThrow("Could not prepare arenas; admission is disabled");
    expect(polls).toBe(1);
    expect(sleeps).toBe(0);
  });

  it("times out cleanly when arenas neither open nor fail within maxAttempts", async () => {
    let polls = 0;
    await expect(
      arenaAdmission(fakeServer, {
        readLogs: () => {
          polls++;
          return Promise.resolve("[Server thread/INFO]: Done (12.3s)!");
        },
        sleep: () => Promise.resolve(),
        maxAttempts: 3,
      }),
    ).rejects.toThrow("The authored arenas did not open after Paper startup");
    expect(polls).toBe(3);
  });
});
