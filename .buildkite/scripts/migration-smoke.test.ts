import { expect, test } from "bun:test";

test("Buildkite migration entrypoints load without running", async () => {
  await Promise.all([
    import("./annotate-build-summary.ts"),
    import("./bake-images.ts"),
    import("./bake-retry.ts"),
    import("./build-ci-image.ts"),
    import("./buildkit-env.ts"),
    import("./ci-changed.ts"),
    import("./prepare-ci-changed-base.ts"),
  ]);
  expect(true).toBe(true);
});
