export type ConditionalHeadProbe = {
  create: (key: string) => Promise<string>;
  head: (key: string, etag: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/**
 * R2 ignores If-Match on DELETE, so cleanup cannot make each delete atomic.
 * It instead re-checks each reviewed key with a conditional HEAD immediately
 * before deleting it. Never assume an S3-compatible provider honors that
 * header: prove a mismatched ETag is rejected and a matching one accepted.
 */
export async function verifyConditionalHead(
  probe: ConditionalHeadProbe,
): Promise<void> {
  const key = `ops-cleanup-precondition-probes/${crypto.randomUUID()}`;
  const etag = await probe.create(key);
  try {
    let rejected = false;
    try {
      await probe.head(key, '"intentionally-mismatched-etag"');
    } catch (error) {
      if (!(error instanceof Error) || !isPreconditionFailure(error.message))
        throw error;
      rejected = true;
    }
    if (!rejected)
      throw new Error(
        "Provider ignored conditional HEAD; backup cleanup refused",
      );
    await probe.head(key, etag);
  } finally {
    await probe.remove(key);
  }
}

function isPreconditionFailure(message: string): boolean {
  return message.includes("PreconditionFailed") || message.includes("(412)");
}
