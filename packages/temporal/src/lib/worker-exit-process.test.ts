import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { PROMOTION_POD_TERMINATION_SECONDS } from "@shepherdjerred/ops-model/promotion/drain-policy.ts";
import { collectOutput, waitForLog } from "./fixtures/wait-for-log.ts";
import { POST_DRAIN_EXIT_MS } from "./worker-exit.ts";

it("forces a process with a leaked handle out once its drain completes, never before", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(
        new URL("fixtures/worker-exit-process.ts", import.meta.url),
      ),
    ],
    { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" },
  );
  try {
    const stdout = collectOutput(child.stdout);
    await waitForLog({
      output: stdout.text,
      text: "READY",
      child,
      timeoutMs: 10_000,
    });
    const signalled = Date.now();
    child.kill("SIGTERM");
    const exitCode = await child.exited;
    const exited = Date.now();
    await stdout.done;
    expect(exitCode, await new Response(child.stderr).text()).toBe(1);
    const drained = Number(
      /DRAINED (?<at>\d+)/u.exec(stdout.text())?.groups?.["at"],
    );
    // The in-flight Activity kept its whole 1.5 s drain…
    expect(drained - signalled).toBeGreaterThanOrEqual(1400);
    // …and the leaked server held the process only for the backstop.
    expect(stdout.text()).toContain('FORCED {"graceMs":250}');
    expect(exited - drained).toBeLessThan(3000);
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
  }
}, 20_000);

it("keeps the post-drain backstop far inside every worker's termination grace", () => {
  // 2026-11-14: a promotion worker that had finished draining idled for its
  // whole 18-minute grace, past the Delivery sync readback (120 × 5 s) and
  // the Deployment progress deadline (600 s), and failed its own rollout.
  // The grace is a maximum for in-flight promotions, not a wait: an idle
  // worker must be gone within the backstop, and the backstop must fit the
  // 30 s default grace every other worker pod has.
  const DEFAULT_POD_TERMINATION_SECONDS = 30;
  expect(POST_DRAIN_EXIT_MS).toBeLessThanOrEqual(
    (DEFAULT_POD_TERMINATION_SECONDS * 1000) / 2,
  );
  expect(POST_DRAIN_EXIT_MS).toBeLessThan(
    PROMOTION_POD_TERMINATION_SECONDS * 1000,
  );
});
