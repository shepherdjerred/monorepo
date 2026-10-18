import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { z } from "zod";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";

const Identity = z.string().min(1);
const SourceJournal = z.object({
  schemaVersion: z.literal(1),
  context: z.literal("delivery-tsmc-validation"),
  namespace: z.literal("minecraft-tsmc"),
  requestId: z.uuid(),
  candidateImage: Identity,
  productionWriteAuthorized: z.literal(false),
  rollbackImage: Identity,
  rollbackTemplate: z.record(z.string(), z.json()),
  serverUid: Identity,
  claimUid: Identity,
  volumeName: Identity,
  volumeUid: Identity,
  volumeSource: z.object({ driver: Identity, volumeHandle: Identity }).strict(),
  services: z.record(
    z.string(),
    z
      .object({ uid: Identity, selector: z.record(z.string(), z.string()) })
      .strict(),
  ),
  deliveryValidation: z.object({
    sourceApplication: z
      .object({
        uid: Identity,
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  }),
});

/** Mutable progress is excluded; original identities and source bindings remain immutable. */
export async function sourceJournalFingerprint(
  file: string,
  input: { requestId: string; candidateImage: string },
) {
  const metadata = await lstat(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size > 10_000_000
  )
    throw new Error(
      "Original Minecraft source journal is not private, regular and bounded",
    );
  const source = SourceJournal.parse(await Bun.file(file).json());
  if (
    source.requestId !== input.requestId ||
    source.candidateImage !== input.candidateImage
  )
    throw new Error(
      "Original source journal belongs to another immutable Minecraft request",
    );
  return createHash("sha256").update(canonicalJson(source)).digest("hex");
}
