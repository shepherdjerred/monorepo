import { expect, test } from "vitest";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";
import { createOriginalForumPolicyReader } from "./legacy-policy.ts";
import { createForumPolicyReader } from "./source-policy.ts";

test("original pre-extraction manifest is projected at its original immutable SHA without relabeling", async () => {
  const revision = "a".repeat(40),
    urls: string[] = [];
  const transport = (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    urls.push(url);
    return Promise.resolve(
      url.endsWith("/config/forum.json")
        ? Response.json({
            ...forumBundlePolicy,
            title: "Original product configuration",
            stages: { prod: {} },
          })
        : new Response("missing", { status: 404 }),
    );
  };
  const result = await createOriginalForumPolicyReader(transport)(revision);
  expect(result.legacy).toBe(true);
  expect(forumBundlePolicyDigest(result.policy)).toBe(
    forumBundlePolicyDigest(forumBundlePolicy),
  );
  expect(urls).toEqual([
    `https://raw.githubusercontent.com/shepherdjerred/monorepo/${revision}/packages/ops-model/src/forum-bundle-policy.json`,
    `https://raw.githubusercontent.com/shepherdjerred/monorepo/${revision}/packages/storm-forum/config/forum.json`,
  ]);
  await expect(
    createForumPolicyReader(transport)(revision),
  ).rejects.toMatchObject({ code: "INVALID" });
});
test.each([503, 403, 200])(
  "never treats neutral policy status %s as a legacy source",
  async (status) => {
    let requests = 0;
    await expect(
      createOriginalForumPolicyReader(() => {
        requests++;
        return Promise.resolve(new Response("corrupt", { status }));
      })("a".repeat(40)),
    ).rejects.toThrow();
    expect(requests).toBe(1);
  },
);
test.each([
  "{",
  "x".repeat(33 * 1024),
  JSON.stringify({ ...forumBundlePolicy, vendorDependencies: [] }),
])(
  "rejects malformed or incomplete original licensed manifests",
  async (body) => {
    await expect(
      createOriginalForumPolicyReader((url) =>
        Promise.resolve(
          (url instanceof Request ? url.url : url.toString()).endsWith(
            "/config/forum.json",
          )
            ? new Response(body)
            : new Response("missing", { status: 404 }),
        ),
      )("a".repeat(40)),
    ).rejects.toMatchObject({ code: "INVALID" });
  },
);
