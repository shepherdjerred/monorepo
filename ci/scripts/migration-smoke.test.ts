import { expect, test } from "vitest";

/**
 * Every shell script the migration ledger says was ported still has a loadable
 * TypeScript entrypoint.
 *
 * `annotate-build-summary` and `prepare-ci-changed-base` are absent by design
 * rather than by oversight: the first produced a Buildkite annotation, which
 * has no successor, and the second asked Buildkite's API for the last green
 * main build, which the configuration extension now resolves before any step
 * is generated. Both are recorded as retired in script-migrations.json.
 */
test("ported CI entrypoints load without running", async () => {
  await Promise.all([
    import("./images/bake-images.ts"),
    import("./images/bake-retry.ts"),
    import("./images/build-ci-image.ts"),
    import("./reporting/buildkit-env.ts"),
    import("./selectors/ci-changed.ts"),
  ]);
  expect(true).toBe(true);
});
