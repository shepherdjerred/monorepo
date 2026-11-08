import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as Activity from "@temporalio/activity";

vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
    }),
  },
}));

const {
  GUARDED_ARGO_OUTPUT_LIMIT,
  GuardedArgoCommandError,
  runGuardedArgoCommand,
} = await import("./argocd.ts");

const token = "argocd-token-for-the-output-test-0123456789";

/** Stands the guarded CLI in with a real child that writes `stderr` and exits. */
function guardedCommand(stderr: string, exitCode: number) {
  const spawn = Bun.spawn;
  vi.spyOn(Bun, "spawn").mockImplementation(() =>
    spawn(["sh", "-c", `printf '%s' "$OUT" >&2; exit ${String(exitCode)}`], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      env: { ...Bun.env, OUT: stderr },
    }),
  );
}

async function failure(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected the guarded command to fail");
}

const details = { operationId: "op-1", application: "temporal" };

beforeEach(() => {
  vi.stubEnv("ARGOCD_TOKEN", token);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("a guarded Argo command's explanation", () => {
  test("survives as the redacted tail of its stderr", async () => {
    const findings =
      "Refusing temporal sync because the read-only apply-safety preflight found:\n- batch/Job temporal/temporal-namespace-init changes immutable /spec/template";
    guardedCommand(
      `${"x".repeat(10_000)}\nAuthorization: Bearer ${token}\n${findings}`,
      1,
    );
    const error = await failure(
      runGuardedArgoCommand(["assert-apply-safe", "temporal"], details),
    );
    if (!(error instanceof GuardedArgoCommandError))
      throw new Error("expected a GuardedArgoCommandError");
    expect(error).toMatchObject({ command: "assert-apply-safe", exitCode: 1 });
    const { output, message } = error;
    expect(output.endsWith(findings)).toBe(true);
    expect(output.length).toBeLessThanOrEqual(GUARDED_ARGO_OUTPUT_LIMIT);
    expect(output).not.toContain(token);
    expect(output).toContain("Bearer ***");
    expect(message).toContain(findings);
  });

  test("a silent failure keeps the established message", async () => {
    guardedCommand("", 1);
    const error = await failure(
      runGuardedArgoCommand(["sync-managed", "temporal"], details),
    );
    expect(error).toMatchObject({
      message:
        "Guarded Argo sync-managed failed; inspect the recorded request before retrying",
      output: "",
    });
  });

  test("a successful command resolves", async () => {
    guardedCommand("progress", 0);
    await expect(
      runGuardedArgoCommand(["sync-managed", "temporal"], details),
    ).resolves.toBeUndefined();
  });
});
