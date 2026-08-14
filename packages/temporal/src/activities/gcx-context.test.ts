import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  ensureGcxContext,
  GcxContextError,
  resetGcxContextForTesting,
  type GcxSpawn,
} from "#activities/gcx-context.ts";

const TOKEN = "glsa_supersecretvalue_0123456789";

type SpawnCall = { args: string[] };

function noop(): void {
  // The stub never spawns a process, so there is nothing to kill.
}

/** A missing credential must reject before gcx is ever invoked. */
async function expectNoLoginAttempt(): Promise<void> {
  const calls: SpawnCall[] = [];
  await expect(
    ensureGcxContext(stubSpawn({ exitCode: 0, calls })),
  ).rejects.toThrow(GcxContextError);
  expect(calls).toHaveLength(0);
}

function stubSpawn(options: {
  exitCode: number;
  stderr?: string;
  calls?: SpawnCall[];
}): GcxSpawn {
  return (args) => {
    options.calls?.push({ args });
    return {
      stderr: new Response(options.stderr ?? "").body ?? new ReadableStream(),
      exited: Promise.resolve(options.exitCode),
      kill: noop,
    };
  };
}

describe("ensureGcxContext", () => {
  const originalUrl = Bun.env["GRAFANA_URL"];
  const originalKey = Bun.env["GRAFANA_API_KEY"];

  beforeEach(() => {
    resetGcxContextForTesting();
    Bun.env["GRAFANA_URL"] = "https://grafana.example.ts.net";
    Bun.env["GRAFANA_API_KEY"] = TOKEN;
  });

  afterEach(() => {
    resetGcxContextForTesting();
    if (originalUrl === undefined) delete Bun.env["GRAFANA_URL"];
    else Bun.env["GRAFANA_URL"] = originalUrl;
    if (originalKey === undefined) delete Bun.env["GRAFANA_API_KEY"];
    else Bun.env["GRAFANA_API_KEY"] = originalKey;
  });

  test("logs in with the canonical env vars and the homelab context", async () => {
    const calls: SpawnCall[] = [];
    await ensureGcxContext(stubSpawn({ exitCode: 0, calls }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "gcx",
      "login",
      "homelab",
      "--server",
      "https://grafana.example.ts.net",
      "--token",
      TOKEN,
      "--yes",
    ]);
  });

  test("memoizes so both the collector and the preflight share one login", async () => {
    const calls: SpawnCall[] = [];
    const spawn = stubSpawn({ exitCode: 0, calls });

    await ensureGcxContext(spawn);
    await ensureGcxContext(spawn);

    expect(calls).toHaveLength(1);
  });

  test("fails fast when GRAFANA_URL is missing", async () => {
    delete Bun.env["GRAFANA_URL"];
    await expectNoLoginAttempt();
  });

  test("fails fast when GRAFANA_API_KEY is missing", async () => {
    delete Bun.env["GRAFANA_API_KEY"];
    await expectNoLoginAttempt();
  });

  test("fails fast when the env var is present but blank", async () => {
    Bun.env["GRAFANA_API_KEY"] = "   ";

    await expect(ensureGcxContext(stubSpawn({ exitCode: 0 }))).rejects.toThrow(
      GcxContextError,
    );
  });

  test("trims the env values it passes to gcx", async () => {
    Bun.env["GRAFANA_URL"] = "  https://grafana.example.ts.net\n";
    Bun.env["GRAFANA_API_KEY"] = `\n${TOKEN}  `;

    const calls: SpawnCall[] = [];
    await ensureGcxContext(stubSpawn({ exitCode: 0, calls }));

    expect(calls[0]?.args).toEqual([
      "gcx",
      "login",
      "homelab",
      "--server",
      "https://grafana.example.ts.net",
      "--token",
      TOKEN,
      "--yes",
    ]);
  });

  test("rejects at the deadline when the subprocess never settles", async () => {
    let killed = false;
    const neverSettles: GcxSpawn = () => ({
      // A child that ignores the signal settles neither of these, so killing
      // it cannot on its own end the wait.
      stderr: new ReadableStream(),
      exited: new Promise<number>(() => {
        // Deliberately never settled.
      }),
      kill: () => {
        killed = true;
      },
    });

    await expect(ensureGcxContext(neverSettles, 25)).rejects.toThrow(
      /did not complete within 25ms/,
    );
    expect(killed).toBe(true);
  });

  test("redacts the credential out of a failing login's stderr", async () => {
    const spawn = stubSpawn({
      exitCode: 3,
      stderr: `unauthorized while using --token ${TOKEN}`,
    });

    let captured: unknown;
    try {
      await ensureGcxContext(spawn);
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(GcxContextError);
    expect(String(captured)).not.toContain(TOKEN);
    expect(String(captured)).toContain("***");
    expect(String(captured)).toContain("exited 3");
  });

  test("does not cache a failure, so a transient outage can recover", async () => {
    const failingCalls: SpawnCall[] = [];
    await expect(
      ensureGcxContext(
        stubSpawn({ exitCode: 1, stderr: "boom", calls: failingCalls }),
      ),
    ).rejects.toThrow(GcxContextError);

    const retryCalls: SpawnCall[] = [];
    await ensureGcxContext(stubSpawn({ exitCode: 0, calls: retryCalls }));

    expect(failingCalls).toHaveLength(1);
    expect(retryCalls).toHaveLength(1);
  });
});
