import { expect, test } from "vitest";

test("Buildkite migration entrypoints load without running", async () => {
  await Promise.all([
    import("./reporting/annotate-build-summary.ts"),
    import("./images/bake-images.ts"),
    import("./images/bake-retry.ts"),
    import("./images/build-ci-image.ts"),
    import("./reporting/buildkit-env.ts"),
    import("./selectors/ci-changed.ts"),
    import("./selectors/prepare-ci-changed-base.ts"),
  ]);
  expect(true).toBe(true);
});
