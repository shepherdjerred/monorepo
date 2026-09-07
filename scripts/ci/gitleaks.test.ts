import { describe, expect, test } from "vitest";
import { gitleaksCommand } from "./gitleaks.ts";

describe("gitleaks CI scope", () => {
  test("scans only commits since the validated green base", async () => {
    expect(
      await gitleaksCommand(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(["packages/example.ts"]),
      ),
    ).toEqual([
      "gitleaks",
      "git",
      "--log-opts=abc123..HEAD",
      "--redact",
      "--no-banner",
      ".",
    ]);
  });

  test("fails open to a complete tree scan", async () => {
    expect(await gitleaksCommand({})).toEqual([
      "gitleaks",
      "detect",
      "--source",
      ".",
      "--no-git",
      "--redact",
      "--no-banner",
    ]);
    expect(
      await gitleaksCommand({ CI_CHANGED_BASE: "missing" }, () =>
        Promise.resolve(1),
      ),
    ).toEqual([
      "gitleaks",
      "detect",
      "--source",
      ".",
      "--no-git",
      "--redact",
      "--no-banner",
    ]);
  });

  test.each([".gitleaks.toml", ".mise.toml"])(
    "scans the complete tree when %s changes",
    async (path) => {
      expect(
        await gitleaksCommand(
          { CI_CHANGED_BASE: "abc123" },
          () => Promise.resolve(0),
          () => Promise.resolve([path]),
        ),
      ).toEqual([
        "gitleaks",
        "detect",
        "--source",
        ".",
        "--no-git",
        "--redact",
        "--no-banner",
      ]);
    },
  );
});
