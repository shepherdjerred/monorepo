import { afterEach, describe, expect, test, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CREDENTIAL_REGISTRY,
  requiredCredentialsFor,
  resolveCredentials,
} from "#lib/credentials.ts";
import type { CredentialRun } from "#lib/credentials.ts";

type RunFn = CredentialRun;

const MANAGED_VARS = [
  "GRAFANA_API_KEY",
  "LINEAR_API_KEY",
  "POSTHOG_CLI_API_KEY",
  "CF_API_TOKEN",
  "ARGOCD_AUTH_TOKEN",
  "DISCORD_USER_TOKEN",
  "DISCORD_BOT_TOKEN",
  "BUGSINK_TOKEN",
  "WOODPECKER_TOKEN",
  "TEMPORAL_API_KEY",
  "OP_SERVICE_ACCOUNT_TOKEN",
] as const;

const directories: string[] = [];
const stderrLines: string[] = [];
let restoreError: { mockRestore: () => void } | null = null;

function savedEnvironment(): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (const name of MANAGED_VARS) {
    saved.set(name, Bun.env[name]);
  }
  return saved;
}

function restoreEnvironment(saved: Map<string, string | undefined>): void {
  for (const name of MANAGED_VARS) {
    const value = saved.get(name);
    if (value === undefined) {
      Reflect.deleteProperty(Bun.env, name);
    } else {
      Bun.env[name] = value;
    }
  }
}

async function configPath(contents: string | null): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-creds-"));
  directories.push(directory);
  const file = path.join(directory, "config.toml");
  if (contents !== null) {
    await writeFile(file, contents);
  }
  return file;
}

function stubRun(
  handler: (argv: string[]) => { exit: number; stdout: string; stderr: string },
  calls: string[][],
): RunFn {
  return (argv) => {
    calls.push(argv);
    return Promise.resolve(handler(argv));
  };
}

afterEach(async () => {
  restoreError?.mockRestore();
  restoreError = null;
  stderrLines.length = 0;
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function withIsolatedEnv(fn: () => Promise<void>): Promise<void> {
  const saved = savedEnvironment();
  try {
    for (const name of MANAGED_VARS) {
      Reflect.deleteProperty(Bun.env, name);
    }
    restoreError = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        stderrLines.push(args.map(String).join(" "));
      });
    await fn();
  } finally {
    restoreEnvironment(saved);
  }
}

describe("credential resolver precedence", () => {
  test("ambient env wins silently without touching backends", async () => {
    await withIsolatedEnv(async () => {
      Bun.env["GRAFANA_API_KEY"] = "env-wins-value";
      const calls: string[][] = [];
      const run = stubRun(() => {
        throw new Error("backend must not run when env is set");
      }, calls);
      const missing = await configPath(null);
      await resolveCredentials(["GRAFANA_API_KEY"], {
        run,
        configPath: `${missing}.absent`,
      });
      expect(Bun.env["GRAFANA_API_KEY"]).toBe("env-wins-value");
      expect(calls).toEqual([]);
      expect(stderrLines).toEqual([]);
    });
  });

  test("config keychain override beats the registry source", async () => {
    await withIsolatedEnv(async () => {
      const file = await configPath(
        '[credentials]\nWOODPECKER_TOKEN = "keychain:custom-service"\n',
      );
      const calls: string[][] = [];
      const run = stubRun((argv) => {
        expect(argv.slice(0, 2)).toEqual(["security", "find-generic-password"]);
        expect(argv).toContain("custom-service");
        expect(argv).not.toContain("monorepo-workstation-woodpecker-token");
        return { exit: 0, stdout: "config-keychain-secret\n", stderr: "" };
      }, calls);
      await resolveCredentials(["WOODPECKER_TOKEN"], {
        run,
        configPath: file,
      });
      expect(Bun.env["WOODPECKER_TOKEN"]).toBe("config-keychain-secret");
      expect(calls).toHaveLength(1);
      expect(stderrLines).toContain("toolkit: WOODPECKER_TOKEN via config");
      expect(stderrLines.join("\n")).not.toContain("config-keychain-secret");
    });
  });

  test("config op override uses the custom ref with ambient SA token", async () => {
    await withIsolatedEnv(async () => {
      Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "ambient-sa-token";
      const file = await configPath(
        '[credentials]\nLINEAR_API_KEY = "op://Custom/Item/field"\n',
      );
      const calls: string[][] = [];
      const run = stubRun((argv) => {
        expect(argv).toEqual(["op", "read", "op://Custom/Item/field"]);
        return { exit: 0, stdout: "config-sa-secret", stderr: "" };
      }, calls);
      await resolveCredentials(["LINEAR_API_KEY"], {
        run,
        configPath: file,
      });
      expect(Bun.env["LINEAR_API_KEY"]).toBe("config-sa-secret");
      expect(calls).toHaveLength(1);
      expect(stderrLines).toContain("toolkit: LINEAR_API_KEY via config");
    });
  });

  test("missing everywhere names the var and enrollment without leaking", async () => {
    await withIsolatedEnv(async () => {
      Bun.env["GRAFANA_API_KEY"] = "decoy-must-never-print";
      const missing = await configPath(null);
      const calls: string[][] = [];
      const run = stubRun(
        () => ({ exit: 1, stdout: "", stderr: "not found" }),
        calls,
      );
      await expect(
        resolveCredentials(["DISCORD_BOT_TOKEN"], {
          run,
          configPath: `${missing}.absent`,
        }),
      ).rejects.toThrow(
        /DISCORD_BOT_TOKEN.*Discord bot token.*enroll-workstation-secret.*monorepo-workstation-discord-bot-token/,
      );
      expect(Bun.env["DISCORD_BOT_TOKEN"]).toBeUndefined();
      expect(stderrLines.join("\n")).not.toContain("decoy-must-never-print");
    });
  });

  test("each var resolves once per process", async () => {
    await withIsolatedEnv(async () => {
      Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "ambient-sa-token";
      const missing = await configPath(null);
      const calls: string[][] = [];
      const run = stubRun((argv) => {
        expect(argv[0]).toBe("op");
        return { exit: 0, stdout: "memo-secret", stderr: "" };
      }, calls);
      const deps = { run, configPath: `${missing}.absent` };
      await resolveCredentials(["POSTHOG_CLI_API_KEY"], deps);
      await resolveCredentials(["POSTHOG_CLI_API_KEY"], deps);
      expect(calls).toHaveLength(1);
      expect(Bun.env["POSTHOG_CLI_API_KEY"]).toBe("memo-secret");
    });
  });
});

describe("credential resolver backends", () => {
  test("registry keychain backend trims and injects", async () => {
    await withIsolatedEnv(async () => {
      const missing = await configPath(null);
      const calls: string[][] = [];
      const run = stubRun((argv) => {
        expect(argv[0]).toBe("security");
        expect(argv).toContain("monorepo-workstation-bugsink-token");
        return { exit: 0, stdout: "  test-bugsink-secret\n", stderr: "" };
      }, calls);
      await resolveCredentials(["BUGSINK_TOKEN"], {
        run,
        configPath: `${missing}.absent`,
      });
      expect(Bun.env["BUGSINK_TOKEN"]).toBe("test-bugsink-secret");
      expect(calls).toHaveLength(1);
      expect(stderrLines).toContain("toolkit: BUGSINK_TOKEN via keychain");
      expect(stderrLines.join("\n")).not.toContain("test-bugsink-secret");
    });
  });

  test("registry service-account backend reads via op", async () => {
    await withIsolatedEnv(async () => {
      Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "ambient-sa-token";
      const missing = await configPath(null);
      const calls: string[][] = [];
      const run = stubRun((argv) => {
        expect(argv).toEqual([
          "op",
          "read",
          // eslint-disable-next-line no-secrets/no-secrets -- op:// vault/item locator, not a secret value
          "op://v64ocnykdqju4ui6j6pua56xw4/yikdwue26c7gdbk5ftbvaclkli/ARGOCD_AUTH_TOKEN",
        ]);
        return { exit: 0, stdout: "test-argocd-secret\n", stderr: "" };
      }, calls);
      await resolveCredentials(["ARGOCD_AUTH_TOKEN"], {
        run,
        configPath: `${missing}.absent`,
      });
      expect(Bun.env["ARGOCD_AUTH_TOKEN"]).toBe("test-argocd-secret");
      expect(calls).toHaveLength(1);
      expect(stderrLines).toContain(
        "toolkit: ARGOCD_AUTH_TOKEN via service-account",
      );
      expect(stderrLines.join("\n")).not.toContain("test-argocd-secret");
    });
  });

  test("default runner shells to a fake-PATH security shim", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    await withIsolatedEnv(async () => {
      const originalPath = Bun.env["PATH"];
      try {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), "toolkit-creds-shim-"),
        );
        directories.push(directory);
        const shim = path.join(directory, "security");
        await Bun.write(
          shim,
          '#!/bin/sh\ncase "$*" in *"monorepo-workstation-discord-user-token"*) printf "shim-secret\\n"; exit 0;; esac\nexit 1\n',
        );
        await chmod(shim, 0o755);
        Bun.env["PATH"] = `${directory}:${originalPath ?? "/usr/bin:/bin"}`;
        const missing = await configPath(null);
        // No run stub: the default Bun.spawn runner must find the shim on PATH.
        await resolveCredentials(["DISCORD_USER_TOKEN"], {
          configPath: `${missing}.absent`,
        });
        expect(Bun.env["DISCORD_USER_TOKEN"]).toBe("shim-secret");
        expect(stderrLines).toContain(
          "toolkit: DISCORD_USER_TOKEN via keychain",
        );
      } finally {
        if (originalPath === undefined) {
          Reflect.deleteProperty(Bun.env, "PATH");
        } else {
          Bun.env["PATH"] = originalPath;
        }
      }
    });
  });

  test("woodpecker resolves from the service account, not the keychain", () => {
    // The API token lives as WOODPECKER_API_TOKEN on the Woodpecker Server
    // item, which the homelab service account can read (probed 2026-10-04).
    expect(CREDENTIAL_REGISTRY["WOODPECKER_TOKEN"]).toEqual({
      description: "Woodpecker CI API token",
      source: {
        kind: "op",
        // eslint-disable-next-line no-secrets/no-secrets -- op:// vault/item locator, not a secret value
        ref: "op://v64ocnykdqju4ui6j6pua56xw4/covttsojandjk7fx62a3dbk7em/WOODPECKER_API_TOKEN",
      },
    });
  });

  test("temporal resolves its external API key from the service account", () => {
    expect(CREDENTIAL_REGISTRY["TEMPORAL_API_KEY"]).toEqual({
      description: "Temporal external API key",
      source: {
        kind: "op",
        ref: "op://v64ocnykdqju4ui6j6pua56xw4/2x4fpii5zq4jbw3l2p2qkvjtiy/api-token",
      },
    });
  });
});

describe("command credential mapping", () => {
  test("requiredCredentialsFor maps commands to their vars", () => {
    for (const action of ["wait", "explain", "main", "load"]) {
      expect(requiredCredentialsFor("ci", action)).toEqual([
        "WOODPECKER_TOKEN",
      ]);
    }
    expect(requiredCredentialsFor("woodpecker", undefined)).toEqual([
      "WOODPECKER_TOKEN",
    ]);
    expect(requiredCredentialsFor("pr", "health")).toEqual([
      "WOODPECKER_TOKEN",
    ]);
    expect(requiredCredentialsFor("linear", undefined)).toEqual([
      "LINEAR_API_KEY",
    ]);
    expect(requiredCredentialsFor("bugsink", "issues")).toEqual([
      "BUGSINK_TOKEN",
    ]);
    expect(requiredCredentialsFor("discord", "daemon")).toEqual([
      "DISCORD_BOT_TOKEN",
      "DISCORD_USER_TOKEN",
    ]);
    for (const command of ["grafana", "prom", "loki", "tempo"]) {
      expect(requiredCredentialsFor(command, "x")).toEqual(["GRAFANA_API_KEY"]);
    }
    expect(requiredCredentialsFor("cf", undefined)).toEqual(["CF_API_TOKEN"]);
    expect(requiredCredentialsFor("argocd", "app")).toEqual([
      "ARGOCD_AUTH_TOKEN",
    ]);
    expect(requiredCredentialsFor("posthog", "x")).toEqual([
      "POSTHOG_CLI_API_KEY",
    ]);
    expect(requiredCredentialsFor("temporal", "workflow", {})).toEqual([
      "TEMPORAL_API_KEY",
    ]);
    expect(
      requiredCredentialsFor("temporal", "workflow", {
        TEMPORAL_ADDRESS: "temporal-temporal-server-service:7233",
      }),
    ).toEqual([]);
    expect(
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "temporal-temporal-server-service:7233" },
        ["workflow", "list", "--address", "temporal.tailnet-1a49.ts.net:443"],
      ),
    ).toEqual(["TEMPORAL_API_KEY"]);
    expect(
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "temporal.tailnet-1a49.ts.net:443" },
        ["--address=temporal-temporal-server-service:7233", "workflow", "list"],
      ),
    ).toEqual([]);
    expect(
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "temporal-temporal-server-service:7233" },
        [
          "--address=temporal-temporal-server-service:7233",
          "--address=external.example:443",
          "workflow",
          "list",
        ],
      ),
    ).toEqual(["TEMPORAL_API_KEY"]);
    expect(
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "temporal-temporal-server-service:7233" },
        ["workflow", "list", "--", "--address", "external.example:443"],
      ),
    ).toEqual([]);
    for (const command of ["gh", "ops", "history", "nope"]) {
      expect(requiredCredentialsFor(command, undefined)).toEqual([]);
    }
  });

  test("rejects plaintext transport before resolving an external Temporal API key", () => {
    expect(() =>
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "external.example:443" },
        ["workflow", "list", "--tls=false"],
      ),
    ).toThrow("toolkit: refusing to resolve TEMPORAL_API_KEY with --tls=false");
    expect(
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "temporal-temporal-server-service:7233" },
        ["workflow", "list", "--tls=false"],
      ),
    ).toEqual([]);
    expect(
      requiredCredentialsFor(
        "temporal",
        "workflow",
        { TEMPORAL_ADDRESS: "external.example:443" },
        ["workflow", "execute", "--", "--tls=false"],
      ),
    ).toEqual(["TEMPORAL_API_KEY"]);
  });
});
