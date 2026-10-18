import { createHash } from "node:crypto";
import {
  forumBundlePolicy,
  ForumBundlePolicySchema,
} from "./forum-bundle-policy.ts";

/** Zod's fixed field order gives both producers the same formatting-independent policy identity. */
export function forumBundlePolicyDigest(
  policy: typeof forumBundlePolicy = forumBundlePolicy,
): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(ForumBundlePolicySchema.parse(policy)))
    .digest("hex")}`;
}
