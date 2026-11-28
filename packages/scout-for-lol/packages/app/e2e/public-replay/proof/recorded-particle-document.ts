import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { expect } from "@playwright/test";
import { z } from "zod";

const CompactParticleTrack = z.strictObject({
  kind: z.literal("gzip-recorded-native-terrain-particles"),
  schema: z.literal(1),
  bytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function readRecordedParticleDocument(
  root: string,
): Promise<unknown> {
  const raw: unknown = await Bun.file(
    path.join(root, "recorded-particles.json"),
  ).json();
  if (
    raw === null ||
    typeof raw !== "object" ||
    !("kind" in raw) ||
    raw.kind !== "gzip-recorded-native-terrain-particles"
  )
    return raw;
  const envelope = CompactParticleTrack.parse(raw);
  const compressed = await Bun.file(
    path.join(root, "recorded-particles.json.gz"),
  ).bytes();
  const decoded = gunzipSync(compressed, { maxOutputLength: envelope.bytes });
  expect(decoded.byteLength).toBe(envelope.bytes);
  expect(createHash("sha256").update(decoded).digest("hex")).toBe(
    envelope.sha256,
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
}
