import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ciMaintenanceRetryCommand } from "#commands/ci-maintenance-retry.ts";
import type * as Retry from "#lib/ci/maintenance/retry.ts";
import type { RetryReport } from "#lib/ci/maintenance/retry.ts";

const mocks = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("#lib/ci/maintenance/retry.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Retry>()),
  maintenanceRetry: mocks.retry,
}));

const send = {
  action: "send",
  kind: "workspace-golden",
  requestId: "req-golden",
  blockedReason: "Pipeline 1 ended error",
} as const;
const report = (extra: Partial<RetryReport>): RetryReport => ({
  kind: "workspace-golden",
  dryRun: true,
  plan: send,
  sent: false,
  blockCleared: null,
  observation: null,
  ...extra,
});

let logged: string[] = [];
let originalExit: typeof process.exitCode;
beforeEach(() => {
  originalExit = process.exitCode;
  process.exitCode = 0;
  logged = [];
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation((text: string) => {
    logged.push(text);
  });
});
afterEach(() => {
  process.exitCode = originalExit;
  vi.restoreAllMocks();
});

test("forwards the kind and apply flag; a dry run exits zero", async () => {
  mocks.retry.mockResolvedValue(report({}));
  await ciMaintenanceRetryCommand(["workspace-golden"]);
  expect(mocks.retry.mock.calls[0]?.slice(0, 2)).toEqual([
    "workspace-golden",
    false,
  ]);
  expect(logged[0]).toContain("Dry run; pass --apply to send.");
  expect(process.exitCode ?? 0).toBe(0);
  await ciMaintenanceRetryCommand(["ci-images", "--apply", "--json"]);
  expect(mocks.retry.mock.calls[1]?.slice(0, 2)).toEqual(["ci-images", true]);
});

test("exits 1 when the retry is refused", async () => {
  mocks.retry.mockResolvedValue(
    report({
      plan: { action: "refuse", kind: "ci-images", why: "not blocked" },
    }),
  );
  await ciMaintenanceRetryCommand(["ci-images"]);
  expect(logged[0]).toContain("No retry for ci-images: not blocked");
  expect(process.exitCode).toBe(1);
});

test("exits 1 when the signal was sent but the block did not clear, 0 when it did", async () => {
  mocks.retry.mockResolvedValue(
    report({ dryRun: false, sent: true, blockCleared: false }),
  );
  await ciMaintenanceRetryCommand(["workspace-golden", "--apply"]);
  expect(logged[0]).toContain("the block is still present");
  expect(process.exitCode).toBe(1);

  process.exitCode = 0;
  mocks.retry.mockResolvedValue(
    report({ dryRun: false, sent: true, blockCleared: true }),
  );
  await ciMaintenanceRetryCommand(["workspace-golden", "--apply", "--json"]);
  expect(JSON.parse(logged[1] ?? "")).toMatchObject({ blockCleared: true });
  expect(process.exitCode ?? 0).toBe(0);
});

test("help and invalid arguments never reach the coordinator", async () => {
  await ciMaintenanceRetryCommand(["--help"]);
  expect(logged[0]).toContain("toolkit ci maintenance retry <kind>");
  for (const args of [[], ["bogus"], ["ci-images", "extra"], ["--nope"]])
    await expect(ciMaintenanceRetryCommand(args)).rejects.toThrow();
  expect(mocks.retry).not.toHaveBeenCalled();
});
