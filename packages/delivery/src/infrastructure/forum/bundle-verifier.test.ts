import { expect, test } from "vitest";
import { createForumBundleVerifier } from "./bundle-verifier.ts";
import { ArtifactVersionSchema } from "#shared/contract.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { forumBundlePolicyDigest } from "@shepherdjerred/ops-model/forum-bundle-digest.ts";

test("only one archive may be allocated/read by an API process and the slot is released on failure", async () => {
  let finish: ((bytes: Uint8Array) => void) | undefined,
    calls = 0;
  const verify = createForumBundleVerifier(
    async () => {
      calls++;
      return new Promise<Uint8Array>((resolve) => {
        finish = resolve;
      });
    },
    () => Promise.resolve(forumBundlePolicy),
  );
  const artifact = ArtifactVersionSchema.parse({
    id: "forum/fixture",
    serviceId: "storm-forum",
    buildId: "fixture",
    sourceRevision: "a".repeat(40),
    createdAt: new Date().toISOString(),
    kind: "archive",
    component: "archive:forum-bundle",
    uri: `s3://storm-forum-releases/releases/${"a".repeat(64)}.zip`,
    digest: `sha256:${"a".repeat(64)}`,
    version: "2.3.13",
    origin: {
      kind: "licensed-bundle",
      manifestDigest: forumBundlePolicyDigest(),
      xenforoVersion: "2.3.13",
      producerSourceRevision: "a".repeat(40),
    },
  });
  const first = verify(artifact);
  await Promise.resolve();
  await expect(verify(artifact)).rejects.toMatchObject({ code: "BUSY" });
  expect(calls).toBe(1);
  if (finish === undefined) throw new Error("Verifier did not enter reader");
  finish(new Uint8Array(22));
  await expect(first).rejects.toMatchObject({ code: "INVALID" });
  const next = verify(artifact);
  await Promise.resolve();
  expect(calls).toBe(2);
  finish(new Uint8Array(22));
  await expect(next).rejects.toMatchObject({ code: "INVALID" });
});
