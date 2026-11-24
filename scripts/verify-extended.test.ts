import { describe, expect, test } from "vitest";
import {
  EXTENDED_CONCURRENCY,
  EXTENDED_TASK,
  EXTENDED_VITEST_MAX_WORKERS,
  extendedEnvironment,
  extendedTurboCommand,
} from "./verify-extended.ts";
import { VERIFY_CONCURRENCY } from "./verify.ts";

describe("verify:extended", () => {
  test("runs the extended tier serially under its own bounded concurrency", () => {
    expect(extendedTurboCommand([])).toEqual([
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      "test:extended",
      "--continue",
      `--concurrency=${String(EXTENDED_CONCURRENCY)}`,
    ]);
    expect(EXTENDED_TASK).toBe("test:extended");
    expect(EXTENDED_CONCURRENCY).toBe(1);
    expect(EXTENDED_CONCURRENCY).toBeLessThan(VERIFY_CONCURRENCY);
    expect(EXTENDED_VITEST_MAX_WORKERS).toBe(2);
  });

  test("forwards Turbo arguments such as a three-dot affected filter", () => {
    expect(
      extendedTurboCommand([
        "--filter=...[origin/main...HEAD]",
        "--summarize",
        "--output-logs=errors-only",
      ]),
    ).toEqual(
      expect.arrayContaining([
        "--filter=...[origin/main...HEAD]",
        "--summarize",
        "--output-logs=errors-only",
        `--concurrency=${String(EXTENDED_CONCURRENCY)}`,
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

  test("caps Vitest workers at EXTENDED_VITEST_MAX_WORKERS unless set", () => {
    expect(extendedEnvironment({ PATH: "/bin" })).toEqual({
      PATH: "/bin",
      CI_VITEST_MAX_WORKERS: String(EXTENDED_VITEST_MAX_WORKERS),
    });
    expect(
      extendedEnvironment({ CI_VITEST_MAX_WORKERS: "4" })[
        "CI_VITEST_MAX_WORKERS"
      ],
    ).toBe("4");
  });
});
