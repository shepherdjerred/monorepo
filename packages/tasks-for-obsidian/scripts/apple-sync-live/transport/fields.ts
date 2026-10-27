import { z } from "zod";

export const UuidSchema = z.uuid();
export const SHA256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const maximumFileBytes = 8 * 1024 * 1024;
export const maximumTotalBytes = 64 * 1024 * 1024;
export const maximumChunkBytes = 1024 * 1024;
export const maximumWireBytes = 2 * 1024 * 1024;
export const maximumFiles = 4096;
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !/\p{Cc}/u.test(value) &&
      value
        .split("/")
        .every(
          (part) =>
            part.length > 0 &&
            ![".", "..", "__proto__", "constructor", "prototype"].includes(
              part,
            ),
        ),
  );
export const FileFingerprintSchema = z.strictObject({
  size: z.number().int().min(0).max(maximumFileBytes),
  sha256: SHA256Schema,
});
export const FileBlobSchema = FileFingerprintSchema.extend({
  base64: z.string().max(Math.ceil(maximumFileBytes / 3) * 4),
});
export const ChunkBlobSchema = FileBlobSchema.refine(
  (value) => value.size <= maximumChunkBytes,
);
export const GuestBindingSchema = z.strictObject({
  runID: UuidSchema,
  allowedRemoteVaultID: z.string().min(1).max(256).nullable(),
  round: z.number().int().min(1).max(3),
});
export type GuestBinding = z.infer<typeof GuestBindingSchema>;
export const GuestTargetSchema = z.union([
  z.literal("official"),
  z.literal("evidence"),
  z.strictObject({ profileID: UuidSchema }),
]);
export type GuestTarget = z.infer<typeof GuestTargetSchema>;
export type FileFingerprint = z.infer<typeof FileFingerprintSchema>;
export type FileBlob = z.infer<typeof FileBlobSchema>;

export function contentSHA(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
export function decodeBlob(raw: unknown): Uint8Array {
  const blob = FileBlobSchema.parse(raw),
    bytes = Buffer.from(blob.base64, "base64");
  if (
    bytes.toString("base64") !== blob.base64 ||
    bytes.length !== blob.size ||
    contentSHA(bytes) !== blob.sha256
  )
    throw new Error("Guest file content failed integrity validation");
  return bytes;
}
export function encodeBlob(bytes: Uint8Array): FileBlob {
  return FileBlobSchema.parse({
    size: bytes.length,
    sha256: contentSHA(bytes),
    base64: Buffer.from(bytes).toString("base64"),
  });
}
