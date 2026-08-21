import { describe, expect, it } from "vitest";
import {
  buildMaintenanceCommand,
  cleanTurboCache,
  executeMaintenance,
  spawnMaintenanceCommand,
  type MaintenanceCommand,
  type MaintenanceCommandHooks,
  type MaintenanceFetch,
} from "./maintenance.ts";
import { register } from "#observability/metrics.ts";

function setEnvironment(name: string, value: string | undefined): boolean {
  return value === undefined
    ? Reflect.deleteProperty(Bun.env, name)
    : Reflect.set(Bun.env, name, value);
}

const testHooks: MaintenanceCommandHooks = {
  heartbeat: () => {
    // Temporal heartbeats are not available in unit tests.
  },
  onCancellation: () => {
    // Cancellation is exercised by the subprocess runner test below.
  },
};

const invalidTurboCacheFetcher: MaintenanceFetch = () =>
  Promise.resolve(Response.json({ deleted: "bad", scanned: 1 }));

describe("maintenance command construction", () => {
  it("builds all four direct commands and their mounted paths", async () => {
    const plexTokenFile = Bun.file("/tmp/kometa-plex-token-test");
    const tmdbKeyFile = Bun.file("/tmp/kometa-tmdb-key-test");
    await Bun.write(plexTokenFile, "plex-secret-for-test");
    await Bun.write(tmdbKeyFile, "tmdb-secret-for-test");
    setEnvironment("KOMETA_PLEXTOKEN_FILE", "/tmp/kometa-plex-token-test");
    setEnvironment("KOMETA_TMDBAPIKEY_FILE", "/tmp/kometa-tmdb-key-test");

    expect(await buildMaintenanceCommand("kometa")).toMatchObject({
      command: ["kometa", "--config", "/etc/kometa/config.yml", "--run"],
      env: {
        KOMETA_PLEXTOKEN: "plex-secret-for-test",
        KOMETA_TMDBAPIKEY: "tmdb-secret-for-test",
      },
    });
    expect(
      await buildMaintenanceCommand("buildkite-bun-cache-gc"),
    ).toMatchObject({
      command: ["bash", "/buildkite/maintenance/bun-cache-gc.sh"],
      env: {
        BUN_INSTALL_CACHE_DIR: "/buildkite/bun-cache/data",
        BUN_CACHE_LOCK_FILE: "/buildkite/bun-cache-control/.gc.lock",
      },
    });
    const cacheCommand = await buildMaintenanceCommand(
      "buildkite-bun-cache-gc",
    );
    expect(cacheCommand.env).not.toHaveProperty("KOMETA_PLEXTOKEN");
    expect(
      await buildMaintenanceCommand("buildkite-uv-cache-prune"),
    ).toMatchObject({
      command: ["uv", "cache", "prune", "--ci"],
      env: { UV_CACHE_DIR: "/buildkite/uv-cache" },
    });
    expect(
      await buildMaintenanceCommand("buildkite-trivy-db-refresh"),
    ).toMatchObject({
      command: [
        "trivy",
        "image",
        "--download-db-only",
        "--cache-dir",
        "/buildkite/trivy-db",
      ],
    });
  });

  it("fails fast when Kometa credential files are absent", async () => {
    const plexPath = Bun.env["KOMETA_PLEXTOKEN_FILE"];
    const tmdbPath = Bun.env["KOMETA_TMDBAPIKEY_FILE"];
    setEnvironment("KOMETA_PLEXTOKEN_FILE", undefined);
    setEnvironment("KOMETA_TMDBAPIKEY_FILE", undefined);
    await expect(buildMaintenanceCommand("kometa")).rejects.toThrow(
      "KOMETA_PLEXTOKEN_FILE is required",
    );
    setEnvironment("KOMETA_PLEXTOKEN_FILE", plexPath);
    setEnvironment("KOMETA_TMDBAPIKEY_FILE", tmdbPath);
  });
});

describe("maintenance subprocess runner", () => {
  it("propagates non-zero exits without exposing secret values", async () => {
    const command: MaintenanceCommand = {
      kind: "kometa",
      command: ["sh", "-c", "echo stdout-value; echo secret-value >&2; exit 7"],
      cwd: "/tmp",
      env: {},
      secretValues: ["secret-value"],
    };
    const hooks: MaintenanceCommandHooks = {
      heartbeat: () => {
        // The heartbeat is not relevant to this exit-propagation assertion.
      },
      onCancellation: () => {
        // The subprocess is not cancelled in this assertion.
      },
    };

    await expect(spawnMaintenanceCommand(command, hooks)).rejects.toThrow(
      "kometa command exited 7: stdout-value\n<redacted>",
    );
  });

  it("heartbeats and terminates the subprocess on cancellation", async () => {
    const controller = new AbortController();
    let heartbeats = 0;
    let cancellations = 0;
    const command: MaintenanceCommand = {
      kind: "buildkite-uv-cache-prune",
      command: ["sleep", "60"],
      cwd: "/tmp",
      env: {},
      secretValues: [],
    };
    const hooks: MaintenanceCommandHooks = {
      heartbeat: () => {
        heartbeats += 1;
      },
      cancellationSignal: controller.signal,
      onCancellation: () => {
        cancellations += 1;
      },
      heartbeatIntervalMs: 10,
    };

    const run = spawnMaintenanceCommand(command, hooks);
    await Bun.sleep(30);
    controller.abort();
    await expect(run).rejects.toThrow("The operation was aborted");
    expect(heartbeats).toBeGreaterThan(0);
    expect(cancellations).toBe(1);
  });

  it("records success and failure through the activity boundary", async () => {
    const commands: MaintenanceCommand[] = [];
    const runner = async (
      command: MaintenanceCommand,
      _hooks: MaintenanceCommandHooks,
    ): Promise<number> => {
      commands.push(command);
      return 0;
    };
    setEnvironment("KOMETA_PLEXTOKEN_FILE", "/tmp/kometa-plex-token-test");
    setEnvironment("KOMETA_TMDBAPIKEY_FILE", "/tmp/kometa-tmdb-key-test");
    await Bun.write("/tmp/kometa-plex-token-test", "plex-secret-for-test");
    await Bun.write("/tmp/kometa-tmdb-key-test", "tmdb-secret-for-test");
    await executeMaintenance("kometa", runner, testHooks);
    expect(commands).toHaveLength(1);
    const exposition = await register.metrics();
    expect(exposition).toMatch(
      /kubernetes_maintenance_runs_total\{[^}]*maintenance_job="kometa"[^}]*outcome="success"/,
    );
    expect(exposition).toMatch(
      /kubernetes_maintenance_last_success_timestamp_seconds\{[^}]*maintenance_job="kometa"/,
    );

    const failingRunner = async (
      _command: MaintenanceCommand,
      _hooks: MaintenanceCommandHooks,
    ): Promise<number> => 9;
    // The activity context is supplied explicitly at this unit-test seam.
    await expect(
      executeMaintenance("buildkite-bun-cache-gc", failingRunner, testHooks),
    ).rejects.toThrow("buildkite-bun-cache-gc command exited 9");
  });
});

describe("Turbo cache cleanup", () => {
  it("authenticates, sends the bounded retention query, and records counts", async () => {
    await Bun.write("/tmp/turbo-cache-token-test", "turbo-secret-for-test");
    setEnvironment("TURBO_CACHE_TOKEN_FILE", "/tmp/turbo-cache-token-test");
    let requestUrl = "";
    let authorization = "";
    const fetcher: MaintenanceFetch = (input, init) => {
      requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Promise.resolve(Response.json({ deleted: 7, scanned: 19 }));
    };

    await expect(
      cleanTurboCache(fetcher, new AbortController().signal),
    ).resolves.toEqual({
      deleted: 7,
      scanned: 19,
    });
    expect(requestUrl).toContain("/v8/clean");
    expect(requestUrl).toContain("slug=monorepo");
    expect(requestUrl).toContain("olderThan=30");
    expect(authorization).toBe("Bearer turbo-secret-for-test");
    const exposition = await register.metrics();
    expect(exposition).toContain(
      'maintenance_job="turbo-cache-clean",outcome="success"',
    );
    expect(exposition).toMatch(
      /turbo_cache_cleanup_entries_total\{[^}]*result="deleted"[^}]*\} 7/,
    );
    expect(exposition).toMatch(
      /turbo_cache_cleanup_entries_total\{[^}]*result="scanned"[^}]*\} 19/,
    );
  });

  it("rejects invalid responses and never includes the token in errors", async () => {
    await Bun.write("/tmp/turbo-cache-token-test", "never-log-this-token");
    setEnvironment("TURBO_CACHE_TOKEN_FILE", "/tmp/turbo-cache-token-test");

    let message = "";
    try {
      await cleanTurboCache(
        invalidTurboCacheFetcher,
        new AbortController().signal,
      );
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("never-log-this-token");
    expect(message).toContain("deleted");
  });

  it("fails fast when the token file is not configured", async () => {
    const tokenPath = Bun.env["TURBO_CACHE_TOKEN_FILE"];
    setEnvironment("TURBO_CACHE_TOKEN_FILE", undefined);
    await expect(cleanTurboCache()).rejects.toThrow(
      "TURBO_CACHE_TOKEN_FILE is required",
    );
    setEnvironment("TURBO_CACHE_TOKEN_FILE", tokenPath);
  });
});
