import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const BATCH_SIZE = 30;
const MAX_BATCH_RETRIES = 2;
const MAX_PURGE_RETRIES = 6;
const MAX_RETRY_DELAY_MS = 5000;
const MAX_REPORTED_ERRORS = 8;
const RATE_LIMIT_CODE = 1134;
const PurgeReplySchema = z.object({
  success: z.unknown().optional(),
  errors: z.unknown().optional(),
});
const PurgeErrorCodeSchema = z.object({ code: z.int().nonnegative() });
const PurgeRefusalSchema = z.object({
  success: z.literal(false),
  errors: z.array(PurgeErrorCodeSchema).optional(),
});

type PurgeRequest = {
  zoneId: string;
  files: string[];
  signal: AbortSignal;
  fence: () => Promise<void>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  token: () => string;
};

/** Only an explicit, well-formed provider refusal permits a retry. */
function wasThrottled(status: number, reply: unknown): boolean {
  if (status === 401 || status === 403) return false;
  const refusal = PurgeRefusalSchema.safeParse(reply);
  if (!refusal.success) return false;
  const errors = refusal.data.errors ?? [];
  return (
    status === 429 ||
    (errors.length > 0 && errors.every(({ code }) => code === RATE_LIMIT_CODE))
  );
}

function retryDelayMs(response: Response, retries: number): number | null {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter === null) return 1000 * 2 ** retries;
  const milliseconds = /^\d+$/u.test(retryAfter)
    ? Number(retryAfter) * 1000
    : retryAfter.endsWith(" GMT")
      ? Date.parse(retryAfter) - Date.now()
      : Number.NaN;
  // Refuse a delay outside the request budget. Retrying earlier would ignore
  // the provider's rate limit.
  return Number.isFinite(milliseconds) && milliseconds <= MAX_RETRY_DELAY_MS
    ? Math.max(0, milliseconds)
    : null;
}

function purgeFailure(context: string, raw: unknown): Error {
  const result = PurgeReplySchema.safeParse(raw);
  const errors = result.data?.errors;
  const codes = (Array.isArray(errors) ? errors : [])
    .slice(0, MAX_REPORTED_ERRORS)
    .flatMap((error: unknown) => {
      const parsed = PurgeErrorCodeSchema.safeParse(error);
      return parsed.success ? [parsed.data.code] : [];
    });
  const details = [context];
  if (typeof result.data?.success !== "boolean")
    details.push("invalid response envelope");
  if (codes.length > 0) details.push(`Cloudflare codes ${codes.join(", ")}`);
  return new Error(
    `Selected static-site URL cache purge failed (${details.join(", ")})`,
  );
}

async function readPurgeReply(
  response: Response,
  context: string,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    signal.throwIfAborted();
    throw new Error(
      `Selected static-site URL cache purge failed (${context}, invalid JSON response)`,
    );
  }
}

async function purgeBatch(
  request: PurgeRequest,
  batch: string[],
  position: string,
  retryLimit: number,
): Promise<number> {
  const url = `https://api.cloudflare.com/client/v4/zones/${request.zoneId}/purge_cache`;
  const body = JSON.stringify({ files: batch });
  for (let retries = 0; ; retries++) {
    request.signal.throwIfAborted();
    await request.fence();
    request.signal.throwIfAborted();
    const timeout = AbortSignal.timeout(30_000);
    const signal = AbortSignal.any([request.signal, timeout]);
    const response = await request.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.token()}`,
        "Content-Type": "application/json",
      },
      body,
      signal,
      redirect: "error",
    });
    const context = `batch ${position}, URL count ${String(batch.length)}, HTTP ${String(response.status)}`;
    const raw = await readPurgeReply(response, context, signal);
    const result = PurgeReplySchema.safeParse(raw);
    if (response.ok && result.data?.success === true) return retries;
    if (retries >= retryLimit || !wasThrottled(response.status, raw))
      throw purgeFailure(context, raw);
    const milliseconds = retryDelayMs(response, retries);
    if (milliseconds === null) throw purgeFailure(context, raw);
    await delay(milliseconds, undefined, { signal: request.signal });
  }
}

/** Each exact-URL batch starts with a new ownership proof, even after a refusal. */
export async function purgeCloudflareUrls(
  request: PurgeRequest,
): Promise<void> {
  const batches = Math.ceil(request.files.length / BATCH_SIZE);
  let remainingRetries = MAX_PURGE_RETRIES;
  for (let offset = 0; offset < request.files.length; offset += BATCH_SIZE) {
    const batch = request.files.slice(offset, offset + BATCH_SIZE);
    const position = `${String(offset / BATCH_SIZE + 1)}/${String(batches)}`;
    remainingRetries -= await purgeBatch(
      request,
      batch,
      position,
      Math.min(remainingRetries, MAX_BATCH_RETRIES),
    );
  }
}
