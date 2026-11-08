import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  createCredentialCache,
} from "#lib/credential-cache.ts";
import type { SecretStore } from "#lib/credential-cache.ts";
import {
  DELEGATED_ENVIRONMENT,
  directoryLock,
  exhaustedBudget,
  fileReadLog,
} from "#lib/credential-reads.ts";
import type { ReadEvent } from "#lib/credential-reads.ts";
import { resolveCredentialValues } from "#lib/credentials.ts";
import type { CredentialRun } from "#lib/credentials.ts";

const VALUE = "woodpecker-value-never-logged";
const INSTALLED = "/installed/toolkit";
const directories: string[] = [];
const stderrLines: string[] = [];
let restore: (() => void) | null = null;

async function scratch(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "toolkit-reads-"));
  directories.push(directory);
  return directory;
}

function memoryStore(): SecretStore {
  const items = new Map<string, string>();
  return {
    get: ({ service, name }) =>
      Promise.resolve(items.get(`${service}/${name}`) ?? null),
    set: ({ service, name, value }) => {
      items.set(`${service}/${name}`, value);
      return Promise.resolve();
    },
    delete: ({ service, name }) =>
      Promise.resolve(items.delete(`${service}/${name}`)),
  };
}

type Reply = { exit: number; stdout: string; stderr: string };

function recordingRun(
  handler: (argv: string[]) => Reply | Promise<Reply>,
  calls: { argv: string[]; extra: Record<string, string> }[],
): CredentialRun {
  return async (argv, extra = {}) => {
    calls.push({ argv, extra: { ...extra } });
    return handler(argv);
  };
}

async function isolated(fn: () => Promise<void>): Promise<void> {
  const saved = {
    woodpecker: Bun.env["WOODPECKER_TOKEN"],
    token: Bun.env["OP_SERVICE_ACCOUNT_TOKEN"],
  };
  Reflect.deleteProperty(Bun.env, "WOODPECKER_TOKEN");
  Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] = "ambient-sa-token";
  const spy = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      stderrLines.push(args.map(String).join(" "));
    });
  restore = () => {
    spy.mockRestore();
    for (const [name, value] of [
      ["WOODPECKER_TOKEN", saved.woodpecker],
      ["OP_SERVICE_ACCOUNT_TOKEN", saved.token],
    ] as const) {
      if (value === undefined) Reflect.deleteProperty(Bun.env, name);
      else Bun.env[name] = value;
    }
  };
  await fn();
}

afterEach(async () => {
  restore?.();
  restore = null;
  stderrLines.length = 0;
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function absentConfig(): Promise<string> {
  return path.join(await scratch(), "absent.toml");
}

describe("borrowing the installed toolkit's cache", () => {
  test("an uncached process resolves through the installed binary, not op", async () => {
    await isolated(async () => {
      const calls: { argv: string[]; extra: Record<string, string> }[] = [];
      const run = recordingRun(
        () => ({ exit: 0, stdout: `${VALUE}\n`, stderr: "" }),
        calls,
      );
      const values = await resolveCredentialValues(["WOODPECKER_TOKEN"], {
        run,
        cache: null,
        installedToolkit: INSTALLED,
        configPath: await absentConfig(),
      });
      expect(values["WOODPECKER_TOKEN"]).toBe(VALUE);
      expect(calls).toEqual([
        {
          argv: [
            INSTALLED,
            "run",
            "--env",
            "WOODPECKER_TOKEN",
            "--",
            "/usr/bin/printenv",
            "WOODPECKER_TOKEN",
          ],
          extra: { [DELEGATED_ENVIRONMENT]: "1" },
        },
      ]);
      expect(stderrLines.join("\n")).not.toContain(VALUE);
    });
  });

  test("an install that does not know the credential falls back to op", async () => {
    await isolated(async () => {
      const calls: { argv: string[]; extra: Record<string, string> }[] = [];
      const run = recordingRun(
        (argv) =>
          argv[0] === INSTALLED
            ? {
                exit: 1,
                stdout: "",
                stderr: "toolkit: unknown credential WOODPECKER_TOKEN\n",
              }
            : { exit: 0, stdout: VALUE, stderr: "" },
        calls,
      );
      const values = await resolveCredentialValues(["WOODPECKER_TOKEN"], {
        run,
        cache: null,
        installedToolkit: INSTALLED,
        configPath: await absentConfig(),
      });
      expect(values["WOODPECKER_TOKEN"]).toBe(VALUE);
      expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
        [INSTALLED, "run"],
        ["op", "read"],
      ]);
    });
  });

  test("a delegated failure surfaces the installed binary's reason", async () => {
    await isolated(async () => {
      const run = recordingRun(
        () => ({
          exit: 1,
          stdout: "",
          stderr:
            "toolkit: WOODPECKER_TOKEN (Woodpecker CI API token) could not be read from 1Password: Too many requests.\n",
        }),
        [],
      );
      await expect(
        resolveCredentialValues(["WOODPECKER_TOKEN"], {
          run,
          cache: null,
          installedToolkit: INSTALLED,
          configPath: await absentConfig(),
        }),
      ).rejects.toThrow("could not be read from 1Password: Too many requests.");
    });
  });
});

describe("one reader per credential", () => {
  test("concurrent cold callers make one op read", async () => {
    await isolated(async () => {
      const calls: { argv: string[]; extra: Record<string, string> }[] = [];
      const run = recordingRun(async () => {
        await Bun.sleep(50);
        return { exit: 0, stdout: VALUE, stderr: "" };
      }, calls);
      const deps = {
        run,
        cache: createCredentialCache({
          store: memoryStore(),
          ttlSeconds: 3600,
        }),
        lock: directoryLock({ root: await scratch(), pollMs: 5 }),
        configPath: await absentConfig(),
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          resolveCredentialValues(["WOODPECKER_TOKEN"], deps),
        ),
      );
      expect(results.map((values) => values["WOODPECKER_TOKEN"])).toEqual(
        Array.from({ length: 5 }, () => VALUE),
      );
      expect(calls.filter((call) => call.argv[0] === "op")).toHaveLength(1);
    });
  });

  test("a stale lock left by a dead holder is taken over", async () => {
    const root = await scratch();
    const lock = directoryLock({ root, staleMs: 0, pollMs: 5 });
    const order: string[] = [];
    await lock("op://v/i/f", async () => {
      order.push("first");
      // A second caller treats the held directory as stale and proceeds.
      await lock("op://v/i/f", () => {
        order.push("second");
        return Promise.resolve();
      });
    });
    expect(order).toEqual(["first", "second"]);
  });
});

describe("credential read log", () => {
  test("records backend and outcome without the value", async () => {
    await isolated(async () => {
      const events: ReadEvent[] = [];
      const deps = {
        run: recordingRun(() => ({ exit: 0, stdout: VALUE, stderr: "" }), []),
        cache: createCredentialCache({
          store: memoryStore(),
          ttlSeconds: 3600,
        }),
        readLog: (event: ReadEvent) => {
          events.push(event);
          return Promise.resolve();
        },
        configPath: await absentConfig(),
      };
      await resolveCredentialValues(["WOODPECKER_TOKEN"], deps);
      await resolveCredentialValues(["WOODPECKER_TOKEN"], deps);
      expect(events).toEqual([
        { name: "WOODPECKER_TOKEN", backend: "service-account", outcome: "ok" },
        { name: "WOODPECKER_TOKEN", backend: "cache", outcome: "ok" },
      ]);
    });
  });

  test("the file log is JSONL with context and no value", async () => {
    const file = path.join(await scratch(), "logs", "reads.jsonl");
    const log = fileReadLog({
      file,
      now: () => new Date("2026-11-08T08:00:00.000Z"),
    });
    await log({ name: "WOODPECKER_TOKEN", backend: "cache", outcome: "ok" });
    await log({
      name: "GRAFANA_API_KEY",
      backend: null,
      outcome: "rate-limited",
    });
    const contents = await readFile(file, "utf8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(2);
    const first: unknown = JSON.parse(lines[0] ?? "");
    expect(first).toMatchObject({
      ts: "2026-11-08T08:00:00.000Z",
      host: os.hostname(),
      runtime: "source",
      name: "WOODPECKER_TOKEN",
      backend: "cache",
      outcome: "ok",
    });
    expect(lines.join("\n")).not.toContain(VALUE);
  });
});

describe("rate-limit reasons", () => {
  const TABLE = [
    "TYPE       ACTION        LIMIT    USED    REMAINING    RESET",
    "token      write         100      0       100          N/A",
    "token      read          1000     12      988          47 minutes from now",
    "account    read_write    1000     1000    0            12 hours from now",
  ].join("\n");

  test("names the exhausted budget and its reset", () => {
    expect(exhaustedBudget(TABLE)).toBe(
      "1Password budget exhausted (account read_write 1000/1000 used, resets 12 hours from now); see `op service-account ratelimit`",
    );
    expect(
      exhaustedBudget(TABLE.replace("1000    0 ", "1000    3 ")),
    ).toBeNull();
  });

  test("a rate-limited read reports the reset time", async () => {
    await isolated(async () => {
      const run = recordingRun(
        (argv) =>
          argv[1] === "service-account"
            ? { exit: 0, stdout: TABLE, stderr: "" }
            : {
                exit: 1,
                stdout: "",
                stderr:
                  "[ERROR] 2026/11/08 07:45:00 could not read secret 'op://v/i/f': Too many requests. Your client has been rate-limited. Try again in  seconds\n",
              },
        [],
      );
      await expect(
        resolveCredentialValues(["WOODPECKER_TOKEN"], {
          run,
          configPath: await absentConfig(),
        }),
      ).rejects.toThrow(
        "Too many requests. Your client has been rate-limited. Try again in  seconds 1Password budget exhausted (account read_write 1000/1000 used, resets 12 hours from now)",
      );
    });
  });

  test("the default cache lifetime is one day", () => {
    expect(DEFAULT_CACHE_TTL_SECONDS).toBe(86_400);
  });
});
