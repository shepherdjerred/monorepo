import { createHash } from "node:crypto";
import { S3Client } from "bun";
import { DeliveryError } from "#domain/error.ts";
import type { VerifyForumBundle } from "./bundles.ts";
import { MAX_FORUM_BUNDLE_BYTES } from "./zip-directory.ts";
import { verifyForumBundleZip } from "./zip.ts";
import { requireBundlePolicy } from "./source-policy.ts";
import type { ForumPolicyReader } from "./source-policy.ts";
import { createOriginalForumPolicyReader } from "./legacy-policy.ts";

export type ForumBundleReader = (key: string) => Promise<Uint8Array>;
export function createForumBundleReader(credentials: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): ForumBundleReader {
  const client = new S3Client({
    ...credentials,
    region: "us-east-1",
    bucket: "storm-forum-releases",
  });
  return async (key) => {
    if (!/^releases\/[a-f0-9]{64}\.zip$/u.test(key))
      throw new DeliveryError(
        "INVALID",
        "Only fixed content-addressed forum release keys may be inspected",
      );
    const file = client.file(key),
      stat = await file.stat();
    if (stat.size < 22 || stat.size > MAX_FORUM_BUNDLE_BYTES)
      throw new DeliveryError(
        "INVALID",
        "Licensed archive exceeds the bounded verifier size limit",
      );
    // One exact-size allocation avoids Buffer.concat and compressed-archive copies within the API memory budget.
    const bytes = new Uint8Array(stat.size),
      reader = file.stream().getReader();
    let offset = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        if (offset + item.value.length > bytes.length)
          throw new DeliveryError(
            "INVALID",
            "Licensed archive changed while reading exact immutable bytes",
          );
        bytes.set(item.value, offset);
        offset += item.value.length;
      }
    } finally {
      await reader.cancel();
    }
    if (offset !== bytes.length)
      throw new DeliveryError(
        "INVALID",
        "Licensed archive changed while reading exact immutable bytes",
      );
    return bytes;
  };
}

/** At most one compressed archive can be read/decompressed by this API process. No queued request retains bytes. */
export function createForumBundleVerifier(
  read: ForumBundleReader,
  readPolicy: ForumPolicyReader = async (revision) => {
    const original = await createOriginalForumPolicyReader()(revision);
    return original.policy;
  },
): VerifyForumBundle {
  let active = false;
  return async (artifact) => {
    if (active)
      throw new DeliveryError(
        "BUSY",
        "Independent licensed bundle verification is already running",
      );
    active = true;
    try {
      if (artifact.origin.kind !== "licensed-bundle")
        throw new DeliveryError(
          "INVALID",
          "Licensed bundle has no immutable producer provenance",
        );
      const policy = await readPolicy(artifact.origin.producerSourceRevision);
      requireBundlePolicy(artifact, policy);
      const key = `releases/${artifact.digest.slice(7)}.zip`;
      if (artifact.uri !== `s3://storm-forum-releases/${key}`)
        throw new DeliveryError(
          "INVALID",
          "Licensed archive location differs from its exact digest",
        );
      const bytes = await read(key),
        digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (digest !== artifact.digest)
        throw new DeliveryError(
          "INVALID",
          "Private licensed archive bytes do not match the published checksum",
        );
      await verifyForumBundleZip(bytes, policy);
    } finally {
      active = false;
    }
  };
}
