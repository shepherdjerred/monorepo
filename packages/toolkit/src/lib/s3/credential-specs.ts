/**
 * `agent-share` registered credentials, spread into the toolkit credential
 * registry. The identity can read, write, and list only the `public-sjer-red`
 * and `private-sjer-red` buckets. Both resolve through the 1Password service
 * account; neither is written to disk.
 */

const AGENT_SHARE_S3_ITEM =
  "op://v64ocnykdqju4ui6j6pua56xw4/6ycjkzs7gxdadqp5wnbqy3xjta";

export const AGENT_SHARE_CREDENTIALS = {
  AGENT_SHARE_S3_ACCESS_KEY_ID: {
    description:
      "Scoped SeaweedFS key for the public and private share buckets (aws profile agent-share)",
    source: { kind: "op", ref: `${AGENT_SHARE_S3_ITEM}/access-key-id` },
  },
  AGENT_SHARE_S3_SECRET_ACCESS_KEY: {
    description:
      "Scoped SeaweedFS secret for the public and private share buckets (aws profile agent-share)",
    source: { kind: "op", ref: `${AGENT_SHARE_S3_ITEM}/secret-access-key` },
  },
} as const;
