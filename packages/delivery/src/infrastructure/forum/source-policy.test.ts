import { expect, test } from "vitest";
import {
  createForumPolicyReader,
  requireBundlePolicy,
} from "./source-policy.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";
import { ArtifactVersionSchema } from "#shared/contract.ts";

test("exact immutable producer policy supports new XF versions without API rollout or caller supplied policy", async () => {
  const newer = { ...forumBundlePolicy, xenforoVersion: "2.3.14" },
    revision = "f".repeat(40);
  const read = createForumPolicyReader(async (url, init) => {
    expect(url).toBe(
      `https://raw.githubusercontent.com/shepherdjerred/monorepo/${revision}/packages/ops-model/src/forum-bundle-policy.json`,
    );
    expect(init?.redirect).toBe("error");
    return Response.json(newer);
  });
  const policy = await read(revision),
    artifact = ArtifactVersionSchema.parse({
      id: "fixture",
      serviceId: "storm-forum",
      buildId: "fixture",
      sourceRevision: revision,
      createdAt: new Date().toISOString(),
      kind: "archive",
      component: "archive:forum-bundle",
      uri: `s3://storm-forum-releases/releases/${"a".repeat(64)}.zip`,
      digest: `sha256:${"a".repeat(64)}`,
      version: "2.3.14",
      origin: {
        kind: "licensed-bundle",
        manifestDigest: forumBundlePolicyDigest(policy),
        xenforoVersion: "2.3.14",
        producerSourceRevision: revision,
      },
    });
  expect(() => requireBundlePolicy(artifact, policy)).not.toThrow();
  expect(() => requireBundlePolicy(artifact, forumBundlePolicy)).toThrow(
    /source dependency policy/u,
  );
});
test.each(["main", "../../escape", "a".repeat(39), "a".repeat(41)])(
  "refuses mutable/arbitrary producer source %s without an HTTP request",
  async (revision) => {
    const read = createForumPolicyReader(() => {
      throw new Error("Untrusted source must not be fetched");
    });
    await expect(read(revision)).rejects.toMatchObject({ code: "INVALID" });
  },
);
test("missing historical policy, oversized bytes and corrupt policy fail closed without compiled fallback", async () => {
  const revision = "a".repeat(40);
  for (const response of [
    new Response("missing", { status: 404 }),
    new Response("{"),
    Response.json({ ...forumBundlePolicy, unknown: true }),
    new Response("x".repeat(33 * 1024)),
  ])
    await expect(
      createForumPolicyReader(() => Promise.resolve(response))(revision),
    ).rejects.toMatchObject({ code: "INVALID" });
  await expect(
    createForumPolicyReader(() =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    )(revision),
  ).rejects.toMatchObject({ code: "PAUSED" });
});
