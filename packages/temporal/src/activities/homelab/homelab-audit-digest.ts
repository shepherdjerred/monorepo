/**
 * Content digest for audit evidence receipts.
 *
 * Shared by the collectors so two receipts covering the same bytes always
 * carry the same hash — a reader comparing two audits should not have to
 * wonder whether a differing digest means differing content or a differing
 * implementation.
 */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
