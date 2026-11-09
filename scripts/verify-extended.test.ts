import { describe, expect, test } from "vitest";
import {
  EXTENDED_TASK,
  extendedEnvironment,
  extendedTurboCommand,
} from "./verify-extended.ts";
import { VERIFY_CONCURRENCY, VERIFY_VITEST_MAX_WORKERS } from "./verify.ts";

describe("verify:extended", () => {
  test("runs only the extended tier under verify's concurrency budget", () => {
    expect(extendedTurboCommand([])).toEqual([
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      "test:extended",
      "--continue",
      `--concurrency=${String(VERIFY_CONCURRENCY)}`,
    ]);
    expect(EXTENDED_TASK).toBe("test:extended");
  });

  test("forwards Turbo arguments such as an affected filter", () => {
    expect(
      extendedTurboCommand([
        "--filter=...[origin/main]",
        "--summarize",
        "--output-logs=errors-only",
      ]),
    ).toEqual(
      expect.arrayContaining([
        "--filter=...[origin/main]",
        "--summarize",
        "--output-logs=errors-only",
        `--concurrency=${String(VERIFY_CONCURRENCY)}`,
      ]),
    );
  });

  test("lets a caller override the concurrency", () => {
    const command = extendedTurboCommand(["--concurrency=2"]);
    expect(command.filter((arg) => arg.startsWith("--concurrency"))).toEqual([
      "--concurrency=2",
    ]);
    expect(
      extendedTurboCommand(["--concurrency", "3"]).filter((arg) =>
        arg.startsWith("--concurrency"),
      ),
    ).toEqual(["--concurrency"]);
  });

  test("caps Vitest workers like verify unless the caller set them", () => {
    expect(extendedEnvironment({ PATH: "/bin" })).toEqual({
      PATH: "/bin",
      CI_VITEST_MAX_WORKERS: String(VERIFY_VITEST_MAX_WORKERS),
    });
    expect(
      extendedEnvironment({ CI_VITEST_MAX_WORKERS: "4" })[
        "CI_VITEST_MAX_WORKERS"
      ],
    ).toBe("4");
  });
});
