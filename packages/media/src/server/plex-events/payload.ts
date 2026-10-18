import { z } from "zod";
import {
  PlexHintEventSchema,
  PlexWatchHintSchema,
  PlexDecimalIdSchema,
  PlexServerIdSchema,
  type PlexWatchHint,
} from "#shared/plex-events/contract.ts";

export class PlexEventRequestError extends Error {
  constructor(readonly status: 400 | 413) {
    super(status === 413 ? "Event request too large" : "Invalid event request");
  }
}

const externalId = z.union([
  PlexDecimalIdSchema,
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER).transform(String),
]);
const envelope = z.object({
  event: z.string(),
});
const metadata = z.object({ Metadata: z.object({ type: z.string() }) });
const supported = z.object({
  event: PlexHintEventSchema,
  Server: z.object({ uuid: PlexServerIdSchema }),
  Metadata: z.object({
    type: z.enum(["movie", "episode"]),
    librarySectionID: externalId,
    ratingKey: externalId,
  }),
});

export function projectPlexPayload(raw: unknown): PlexWatchHint | null {
  const outer = envelope.safeParse(raw);
  if (!outer.success) throw new PlexEventRequestError(400);
  if (!PlexHintEventSchema.safeParse(outer.data.event).success) return null;
  const target = metadata.safeParse(raw);
  if (!target.success) throw new PlexEventRequestError(400);
  if (!["movie", "episode"].includes(target.data.Metadata.type)) return null;
  const input = supported.safeParse(raw);
  if (!input.success) throw new PlexEventRequestError(400);
  return PlexWatchHintSchema.parse({
    schemaVersion: 1,
    event: input.data.event,
    serverMachineId: input.data.Server.uuid,
    sectionId: input.data.Metadata.librarySectionID,
    ratingKey: input.data.Metadata.ratingKey,
    mediaKind: input.data.Metadata.type,
  });
}

async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (reader === undefined) throw new PlexEventRequestError(400);
  const body = new Uint8Array(2 * 1024 * 1024);
  let length = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      if (length + item.value.byteLength > body.byteLength)
        throw new PlexEventRequestError(413);
      body.set(item.value, length);
      length += item.value.byteLength;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return body.subarray(0, length);
}

export async function readPlexPayload(
  request: Request,
): Promise<PlexWatchHint | null> {
  const contentType = request.headers.get("Content-Type");
  if (contentType === null || !/^multipart\/form-data\s*;/iu.test(contentType))
    throw new PlexEventRequestError(400);
  const body = await boundedBody(request);
  try {
    // The parser never receives the capability-bearing URL or other headers.
    const form = await new Response(body, {
      headers: { "Content-Type": contentType },
    }).formData();
    const entries = [...form.entries()];
    const payloads = form.getAll("payload");
    if (
      entries.length > 2 ||
      payloads.length !== 1 ||
      form.getAll("thumb").length > 1 ||
      entries.some(([name]) => name !== "payload" && name !== "thumb")
    )
      throw new PlexEventRequestError(400);
    const payload = payloads[0];
    if (typeof payload !== "string") throw new PlexEventRequestError(400);
    if (new TextEncoder().encode(payload).byteLength > 64 * 1024)
      throw new PlexEventRequestError(413);
    return projectPlexPayload(JSON.parse(payload));
  } catch (error) {
    if (error instanceof PlexEventRequestError) throw error;
    throw new PlexEventRequestError(400);
  }
}
