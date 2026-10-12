import { expect, test } from "vitest";

/**
 * Every shell script the migration ledger says was ported still has a loadable
 * TypeScript entrypoint.
 *
 * Scripts the ledger records as retired, such as `annotate-build-summary` and
 * `prepare-ci-changed-base`, are absent by design.
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
