import { afterEach, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
import { CREDENTIAL_REGISTRY } from "#lib/credential-registry.ts";
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

const WOODPECKER_SOURCE = CREDENTIAL_REGISTRY["WOODPECKER_TOKEN"]?.source;
const WOODPECKER_REF =
  WOODPECKER_SOURCE?.kind === "op" ? WOODPECKER_SOURCE.ref : "unset";

/** An installed toolkit that reports `ref` for WOODPECKER_TOKEN. */
function installedReply(ref: string, run: Reply): (argv: string[]) => Reply {
  return (argv) => {
    if (argv[0] !== INSTALLED) return { exit: 0, stdout: VALUE, stderr: "" };
    return argv[1] === "credentials"
      ? {
          exit: 0,
          stdout: JSON.stringify([
            { name: "WOODPECKER_TOKEN", ref, source: "registry" },
          ]),
          stderr: "",
        }
      : run;
  };
}

describe("borrowing the installed toolkit's cache", () => {
  test("an uncached process resolves through the installed binary, not op", async () => {
    await isolated(async () => {
      const calls: { argv: string[]; extra: Record<string, string> }[] = [];
      const run = recordingRun(
        installedReply(WOODPECKER_REF, {
          exit: 0,
          stdout: `${VALUE}\n`,
          stderr: "",
        }),
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
          argv: [INSTALLED, "credentials", "references", "--json"],
          extra: { [DELEGATED_ENVIRONMENT]: "1" },
        },
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
          // The caller's explicit token goes to the trusted reader.
          extra: {
            [DELEGATED_ENVIRONMENT]: "1",
            OP_SERVICE_ACCOUNT_TOKEN: "ambient-sa-token",
          },
        },
      ]);
      expect(stderrLines.join("\n")).not.toContain(VALUE);
    });
  });

  test("an install resolving the name to another reference is not used", async () => {
    await isolated(async () => {
      const calls: { argv: string[]; extra: Record<string, string> }[] = [];
      const run = recordingRun(
        installedReply("op://other/item/field", {
          exit: 0,
          stdout: "wrong-secret",
          stderr: "",
        }),
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
        [INSTALLED, "credentials"],
        ["op", "read"],
      ]);
    });
  });

  test("an install without reference listing falls back to op", async () => {
    await isolated(async () => {
      const calls: { argv: string[]; extra: Record<string, string> }[] = [];
      const run = recordingRun(
        (argv) =>
          argv[0] === INSTALLED
            ? { exit: 2, stdout: "", stderr: "Usage: toolkit credentials\n" }
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
      expect(calls.map((call) => call.argv[0])).toEqual([INSTALLED, "op"]);
    });
  });

  test("a delegated failure surfaces the installed binary's reason", async () => {
    await isolated(async () => {
      const run = recordingRun(
        installedReply(WOODPECKER_REF, {
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

function lockDirectory(root: string, ref: string): string {
  return path.join(root, createHash("sha256").update(ref).digest("hex"));
}

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

  test("a lock whose owner died is taken over", async () => {
    const root = await scratch();
    const directory = lockDirectory(root, "op://v/i/f");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "owner"), "2147483646:dead");
    const lock = directoryLock({ root, pollMs: 5, maxWaitMs: 5000 });
    const started = Date.now();
    await lock("op://v/i/f", () => Promise.resolve());
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await Bun.file(path.join(directory, "owner")).exists()).toBe(false);
  });

  test("a slow live holder keeps its lock", async () => {
    const root = await scratch();
    const directory = lockDirectory(root, "op://v/i/f");
    const lock = directoryLock({ root, staleMs: 0, pollMs: 5, maxWaitMs: 50 });
    await lock("op://v/i/f", async () => {
      const owner = await readFile(path.join(directory, "owner"), "utf8");
      // The waiter gives up after maxWaitMs and runs unlocked; it must not
      // remove or replace the live holder's lock.
      await lock("op://v/i/f", () => Promise.resolve());
      expect(await readFile(path.join(directory, "owner"), "utf8")).toBe(owner);
    });
    expect(await Bun.file(path.join(directory, "owner")).exists()).toBe(false);
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

  test("the file log is daily JSONL with context, no value, and pruning", async () => {
    const directory = path.join(await scratch(), "logs");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "credential-reads-2026-10-01.jsonl"),
      "{}\n",
    );
    await writeFile(
      path.join(directory, "credential-reads-2026-11-01.jsonl"),
      "{}\n",
    );
    const log = fileReadLog({
      directory,
      now: () => new Date("2026-11-08T08:00:00.000Z"),
    });
    await log({ name: "WOODPECKER_TOKEN", backend: "cache", outcome: "ok" });
    await log({
      name: "GRAFANA_API_KEY",
      backend: null,
      outcome: "rate-limited",
    });
    const contents = await readFile(
      path.join(directory, "credential-reads-2026-11-08.jsonl"),
      "utf8",
    );
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
    const remaining = await readdir(directory);
    expect(remaining.toSorted()).toEqual([
      "credential-reads-2026-11-01.jsonl",
      "credential-reads-2026-11-08.jsonl",
    ]);
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
