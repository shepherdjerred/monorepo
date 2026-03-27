import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { z } from "zod";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";

const webhookLogger = logger.child({ module: "webhook" });

const RecordSchema = z.record(z.string(), z.unknown());

export function verifySignature(
  payload: string,
  signature: string,
  secret: string,
  prefix: string,
): boolean {
  const expected = `${prefix}${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

export function getRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const result = RecordSchema.safeParse(obj[key]);
  return result.success ? result.data : undefined;
}

export function extractNestedString(
  obj: Record<string, unknown>,
  key: string,
  nestedKey: string,
): string | undefined {
  const nested = getRecord(obj, key);
  return nested == null ? undefined : getString(nested, nestedKey);
}

function sanitizeForPrompt(value: string): string {
  return value.replaceAll(/[\n\r]/g, " ").slice(0, 500);
}

export function buildPromptBlock(
  header: string,
  fields: Record<string, string>,
): string {
  const lines = [header, "", "--- BEGIN WEBHOOK DATA ---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${sanitizeForPrompt(value)}`);
  }
  lines.push("--- END WEBHOOK DATA ---");
  return lines.join("\n");
}

export function parseJsonBody(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const result = RecordSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

const MAX_BODY_BYTES = 1_048_576; // 1 MB

export async function readBody(c: Context): Promise<string | null> {
  const contentLength = c.req.header("Content-Length");
  if (
    contentLength != null &&
    Number.parseInt(contentLength, 10) > MAX_BODY_BYTES
  ) {
    return null;
  }
  try {
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) return null;
    return new TextDecoder().decode(buf);
  } catch {
    return null;
  }
}

type SigVerifyOptions = {
  rawBody: string;
  headerName: string;
  secret: string | undefined;
  prefix: string;
  provider: string;
};

function verifyMultiSignature(
  payload: string,
  header: string,
  secret: string,
  prefix: string,
): boolean {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  const expected = `${prefix}${hmac.digest("hex")}`;
  const expectedBuf = Buffer.from(expected);
  return header.split(",").some((sig) => {
    const trimmed = sig.trim();
    if (trimmed.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(trimmed), expectedBuf);
  });
}

export function verifyWebhookSignature(
  c: Context,
  options: SigVerifyOptions,
): Response | null {
  if (options.secret == null) {
    webhookLogger.warn(`${options.provider} webhook secret not configured`);
    return c.json({ error: "webhook not configured" }, 500);
  }
  const sig = c.req.header(options.headerName);
  if (sig == null) {
    webhookLogger.warn(`${options.provider} webhook signature missing`);
    return c.json({ error: "invalid signature" }, 401);
  }
  const valid = sig.includes(",")
    ? verifyMultiSignature(options.rawBody, sig, options.secret, options.prefix)
    : verifySignature(options.rawBody, sig, options.secret, options.prefix);
  if (!valid) {
    webhookLogger.warn(
      `${options.provider} webhook signature verification failed`,
    );
    return c.json({ error: "invalid signature" }, 401);
  }
  return null;
}

export function verifyTokenEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
