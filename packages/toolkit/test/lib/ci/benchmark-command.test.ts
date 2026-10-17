import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ciBenchmarkCommand } from "#commands/ci-benchmark.ts";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), config: vi.fn() }));
vi.mock("#lib/ci/benchmark-store.ts", () => ({
  inspectBenchmark: mocks.inspect,
}));
vi.mock("#lib/woodpecker/ci.ts", () => ({
  loadWoodpeckerConfig: mocks.config,
}));
const connection = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "private-token",
  repoId: 1,
};
const args = [
  "evidence",
  "123",
  "--head",
  "a".repeat(40),
  "--variant",
  "candidate",
  "--profile",
  "explicit",
  "--archive",
  "--json",
];
let originalExit: typeof process.exitCode;
beforeEach(() => {
  originalExit = process.exitCode;
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {
    /* Capture structured output. */
  });
  mocks.config.mockResolvedValue(connection);
  mocks.inspect.mockResolvedValue({
    collectionComplete: true,
    resourceHealthy: true,
    taskSuccess: true,
    nativeSuccess: true,
  });
});
afterEach(() => {
  process.exitCode = originalExit;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test("forwards all evidence assertions and reports success as one JSON result", async () => {
  await ciBenchmarkCommand(args);
  expect(mocks.inspect).toHaveBeenCalledWith(
    123,
    {
      head: "a".repeat(40),
      variant: "candidate",
      profile: "explicit",
      archive: true,
    },
    connection,
  );
  expect(process.exitCode).toBe(0);
  expect(console.log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify(
      {
        collectionComplete: true,
        resourceHealthy: true,
        taskSuccess: true,
        nativeSuccess: true,
      },
      null,
      2,
    ),
  );
});

test.each([
  "collectionComplete",
  "resourceHealthy",
  "taskSuccess",
  "nativeSuccess",
])("a recorded %s failure exits 1", async (field) => {
  mocks.inspect.mockResolvedValue({
    collectionComplete: true,
    resourceHealthy: true,
    taskSuccess: true,
    nativeSuccess: true,
    [field]: false,
  });
  await ciBenchmarkCommand(args);
  expect(process.exitCode).toBe(1);
});

test("upstream errors exit 2 with redacted structured evidence", async () => {
  vi.stubEnv("WOODPECKER_TOKEN", "private-token");
  mocks.inspect.mockRejectedValue(
    new Error("Upstream TOKEN=private-value and private-token"),
  );
  await ciBenchmarkCommand(args);
  expect(process.exitCode).toBe(2);
  expect(console.log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      outcome: "error",
      error: "Upstream TOKEN=[REDACTED] and [REDACTED]",
    }),
  );
});
