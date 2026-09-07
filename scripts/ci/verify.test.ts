import { describe, expect, test } from "vitest";
import { affectedVerifyFilters } from "../verify.ts";

describe("affected verification filters", () => {
  test("unions the affected package graph with root invariants", async () => {
    const commands: string[][] = [];
    const filters = await affectedVerifyFilters(
      { CI_CHANGED_BASE: "abc123" },
      (command) => {
        commands.push([...command]);
        return Promise.resolve(0);
      },
      () => Promise.resolve(["packages/example/src/index.ts"]),
    );

    expect(filters).toEqual(["--filter=...[abc123]", "--filter=//"]);
    expect(commands).toEqual([
      ["git", "cat-file", "-e", "abc123^{commit}"],
      ["git", "merge-base", "--is-ancestor", "abc123", "HEAD"],
    ]);
  });

  test("selects root scripts when Buildkite scripts change", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve([".buildkite/scripts/selectors/ci-changed.ts"]),
      ),
    ).toEqual([
      "--filter=...[abc123]",
      "--filter=//",
      "--filter=@shepherdjerred/root-scripts",
    ]);
  });

  test("selects root scripts when pipeline configuration changes", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve([".buildkite/pipeline.yml"]),
      ),
    ).toContain("--filter=@shepherdjerred/root-scripts");
  });

  test("selects root scripts when Renovate configuration changes", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(["renovate.json"]),
      ),
    ).toContain("--filter=@shepherdjerred/root-scripts");
  });

  test("runs the complete graph when changed files cannot be read", async () => {
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123" },
        () => Promise.resolve(0),
        () => Promise.resolve(undefined),
      ),
    ).toEqual([]);
  });

  test("runs the complete graph without a trustworthy base", async () => {
    expect(await affectedVerifyFilters({})).toEqual([]);
    expect(
      await affectedVerifyFilters({ CI_CHANGED_BASE: "missing" }, () =>
        Promise.resolve(1),
      ),
    ).toEqual([]);
  });

  test("fixed-corpus verification deliberately remains complete", async () => {
    let validated = false;
    expect(
      await affectedVerifyFilters(
        { CI_CHANGED_BASE: "abc123", CI_IO_FIXED_CORPUS: "true" },
        () => {
          validated = true;
          return Promise.resolve(0);
        },
      ),
    ).toEqual([]);
    expect(validated).toBe(false);
  });
});
