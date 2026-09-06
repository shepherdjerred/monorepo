import { z } from "zod";

const ErrorDetailSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
});

// The Realtime SDK emits `error` events whose payload is usually a plain object
// (an OpenAI error envelope), not an `Error`. `String(event.error)` on that
// collapses to the useless "[object Object]", erasing the message/code/type we
// need to act on (auth, model access, quota, rate limit, …). This recovers the
// real detail, tolerating both a flat envelope and a nested `{ error: {...} }`.
const RealtimeErrorPayloadSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
  error: ErrorDetailSchema.optional(),
});

function formatDetail(
  detail: z.infer<typeof ErrorDetailSchema>,
): string | null {
  if (detail.message === undefined || detail.message.length === 0) return null;
  const parts = [detail.message];
  if (detail.code !== undefined) parts.push(`(code=${detail.code})`);
  if (detail.type !== undefined) parts.push(`(type=${detail.type})`);
  return parts.join(" ");
}

/** Turn an unknown Realtime error payload into an `Error` that keeps its detail. */
export function realtimeErrorToError(raw: unknown): Error {
  if (raw instanceof Error) return raw;
  const parsed = RealtimeErrorPayloadSchema.safeParse(raw);
  if (parsed.success) {
    const formatted =
      formatDetail(parsed.data.error ?? {}) ?? formatDetail(parsed.data);
    if (formatted !== null) return new Error(formatted);
  }
  return new Error(safeStringify(raw) ?? "Unknown Realtime error");
}

/** JSON.stringify that never throws (bigint) and reports absence honestly. */
function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
