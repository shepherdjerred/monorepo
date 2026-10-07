import { createHash } from "node:crypto";
import { z } from "zod";
import type { RconClient } from "#e2e/harness/rcon.ts";

const Observer = z.strictObject({
  observer: z.string(),
  active: z.boolean(),
  match: z.string(),
  error: z.string(),
});

export async function captureObserver(rcon: RconClient, text: string) {
  const response = await rcon.command(`rwfcapture ${text}`);
  const raw: unknown = JSON.parse(response.trim());
  const error = z.strictObject({ error: z.string() }).safeParse(raw);
  if (error.success) throw new Error(error.data.error);
  return Observer.parse(raw);
}

export function offlineObserverId(): string {
  const bytes = createHash("md5").update("OfflinePlayer:StormPreview").digest();
  bytes[6] = (bytes.readUInt8(6) & 0x0f) | 0x30;
  bytes[8] = (bytes.readUInt8(8) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return z
    .uuid()
    .parse(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
}
