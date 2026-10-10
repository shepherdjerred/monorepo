export type ConditionalDeleteProbe = {
  create: (key: string) => Promise<string>;
  remove: (key: string, etag: string) => Promise<void>;
};

/** Never assume an S3-compatible provider honors conditional DELETE headers. */
export async function verifyConditionalDelete(
  probe: ConditionalDeleteProbe,
): Promise<void> {
  const key = `ops-cleanup-precondition-probes/${crypto.randomUUID()}`;
  const etag = await probe.create(key);
  let rejected = false;
  try {
    await probe.remove(key, '"intentionally-mismatched-etag"');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("PreconditionFailed")
    )
      throw error;
    rejected = true;
  }
  if (!rejected)
    throw new Error(
      "Provider ignored conditional DELETE; backup cleanup refused",
    );
  await probe.remove(key, etag);
}
