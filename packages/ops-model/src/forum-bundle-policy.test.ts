import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import {
  ForumBundlePolicySchema,
  forumBundlePolicy,
} from "./forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "./forum-bundle-digest.ts";

test("licensed source policy has unique reviewed dependencies and formatting-independent identity", () => {
  expect(
    forumBundlePolicy.vendorDependencies
      .map((dependency) => dependency.mode)
      .sort(),
  ).toEqual(["dark", "light"]);
  const reparsed = ForumBundlePolicySchema.parse(
    JSON.parse(JSON.stringify(forumBundlePolicy, null, 2)),
  );
  expect(forumBundlePolicyDigest()).toBe(
    `sha256:${createHash("sha256").update(JSON.stringify(reparsed)).digest("hex")}`,
  );
  expect(
    ForumBundlePolicySchema.safeParse({
      ...forumBundlePolicy,
      vendorDependencies: [
        forumBundlePolicy.vendorDependencies[0],
        forumBundlePolicy.vendorDependencies[0],
      ],
    }).success,
  ).toBe(false);
  expect(
    ForumBundlePolicySchema.safeParse({ ...forumBundlePolicy, extra: true })
      .success,
  ).toBe(false);
});
