import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { pinnedMovieRuntimes } from "#activities/media/testing/role-worker.ts";
import { createLeasedLocalTemporalEnvironment } from "#lib/fixtures/temporal-lease.ts";
import { collectOutput, waitForLog } from "#lib/fixtures/wait-for-log.ts";
import { POST_DRAIN_EXIT_MS } from "#lib/worker-exit.ts";

const EXIT_WITHIN_MS = 5000;

it("exits the real worker entrypoint within seconds of an idle drain", async () => {
  // Must prove the handles are closed, not that the backstop fired.
  expect(EXIT_WITHIN_MS).toBeLessThan(POST_DRAIN_EXIT_MS);
  const runtimePath = Bun.env["PATH"];
  if (runtimePath === undefined) throw new Error("PATH required");
  const environment = await createLeasedLocalTemporalEnvironment({
    server: {
      executable: {
        type: "existing-path",
        path: pinnedMovieRuntimes().temporal,
      },
      ip: "127.0.0.1",
      namespace: "prod",
      ui: false,
      extraArgs: ["--namespace", "beta"],
    },
  });
  const worker = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("worker.ts", import.meta.url))],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        PATH: runtimePath,
        TEMPORAL_WORKER_ROLE: "billing",
        TEMPORAL_NAMESPACE: "prod",
        TEMPORAL_ADDRESS: environment.address.replace(
          /^localhost:/u,
          "127.0.0.1:",
        ),
        TEMPORAL_METRICS_ADDRESS: "127.0.0.1:0",
        APP_METRICS_PORT: "0",
        FEATURE_FLAGS_MODE: "disabled",
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  try {
    const logs = collectOutput(worker.stderr);
    await waitForLog({
      output: logs.text,
      text: '"state":"RUNNING"',
      child: worker,
      timeoutMs: 60_000,
    });
    const signalled = performance.now();
    worker.kill("SIGTERM");
    const exitCode = await worker.exited;
    const elapsed = performance.now() - signalled;
    await logs.done;
    expect(exitCode, logs.text()).toBe(0);
    expect(logs.text()).toContain('"state":"STOPPED"');
    expect(logs.text()).not.toContain("forcing exit");
    expect(elapsed).toBeLessThan(EXIT_WITHIN_MS);
  } finally {
    if (worker.exitCode === null) {
      worker.kill("SIGKILL");
      await worker.exited;
    }
    await environment.teardown();
  }
}, 120_000);
