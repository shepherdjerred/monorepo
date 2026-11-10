import { z } from "zod";

/**
 * One line of the capture spool (`~/.toolkit/brim-capture/spool/*.jsonl`).
 *
 * The mitmproxy addon (`packages/toolkit/capture/brim_capture.py`) writes
 * these and the history daemon ingests them. It is a cross-language contract:
 * `packages/toolkit/schemas/brim-capture-flow.schema.json` is generated from
 * this zod schema, a TS test keeps the two identical, and the addon's pytest
 * suite validates every record it writes against the checked-in JSON Schema.
 *
 * Header values that could carry a credential never reach the spool: the addon
 * drops `authorization`, `x-api-key`, `cookie`, `set-cookie`, and every header
 * whose name contains `token`, `key`, `secret`, or `auth`. Bodies are stored
 * as sent and redacted with the `brim sync` patterns when ingested.
 */

export const CAPTURE_RECORD_VERSION = 1;

const VersionSchema = z.literal(CAPTURE_RECORD_VERSION);

/** A body as UTF-8 text, or base64 when it is not valid UTF-8. */
export const CaptureBodySchema = z
  .union([
    z.strictObject({ text: z.string() }),
    z.strictObject({ base64: z.base64() }),
  ])
  .meta({ title: "BrimCaptureBody" });
export type CaptureBody = z.infer<typeof CaptureBodySchema>;

/** Header name and value pairs in wire order, credentials removed. */
const HeadersSchema = z.array(z.tuple([z.string(), z.string()]));

const RouteFieldsSchema = {
  v: VersionSchema,
  /** The mitmproxy flow id; a WebSocket keeps one id for its whole life. */
  id: z.string().min(1),
  /** The client connection; several flows can share one. */
  connectionId: z.string().min(1),
  /** The CLI whose recorded route matched. */
  cli: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive(),
  path: z.string().min(1),
};

export const CaptureHttpRecordSchema = z
  .strictObject({
    ...RouteFieldsSchema,
    kind: z.literal("http"),
    method: z.string().min(1),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    request: z.strictObject({
      headers: HeadersSchema,
      body: CaptureBodySchema.nullable(),
    }),
    response: z
      .strictObject({
        status: z.number().int(),
        headers: HeadersSchema,
        body: CaptureBodySchema.nullable(),
        /** True when the body was teed from a streamed response. */
        streamed: z.boolean(),
      })
      .nullable(),
    error: z.string().nullable(),
  })
  .meta({ title: "BrimCaptureHttpRecord" });
export type CaptureHttpRecord = z.infer<typeof CaptureHttpRecordSchema>;

export const CaptureWsOpenRecordSchema = z
  .strictObject({
    ...RouteFieldsSchema,
    kind: z.literal("ws-open"),
    at: z.iso.datetime(),
    requestHeaders: HeadersSchema,
    responseHeaders: HeadersSchema,
  })
  .meta({ title: "BrimCaptureWsOpenRecord" });
export type CaptureWsOpenRecord = z.infer<typeof CaptureWsOpenRecordSchema>;

export const CaptureWsMessageRecordSchema = z
  .strictObject({
    v: VersionSchema,
    kind: z.literal("ws-message"),
    id: z.string().min(1),
    /** Position of the message on its WebSocket, from 0. */
    seq: z.number().int().nonnegative(),
    at: z.iso.datetime(),
    fromClient: z.boolean(),
    body: CaptureBodySchema,
  })
  .meta({ title: "BrimCaptureWsMessageRecord" });
export type CaptureWsMessageRecord = z.infer<
  typeof CaptureWsMessageRecordSchema
>;

export const CaptureWsCloseRecordSchema = z
  .strictObject({
    v: VersionSchema,
    kind: z.literal("ws-close"),
    id: z.string().min(1),
    at: z.iso.datetime(),
    code: z.number().int().nullable(),
    reason: z.string().nullable(),
  })
  .meta({ title: "BrimCaptureWsCloseRecord" });
export type CaptureWsCloseRecord = z.infer<typeof CaptureWsCloseRecordSchema>;

export const CaptureRecordSchema = z
  .discriminatedUnion("kind", [
    CaptureHttpRecordSchema,
    CaptureWsOpenRecordSchema,
    CaptureWsMessageRecordSchema,
    CaptureWsCloseRecordSchema,
  ])
  .meta({ title: "BrimCaptureRecord" });
export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;

/** Checked-in contracts, keyed by their `schemas/` file stem. */
export const BRIM_CAPTURE_CONTRACTS = {
  "brim-capture-flow": CaptureRecordSchema,
} as const;

export function bodyBytes(body: CaptureBody): Uint8Array {
  return "text" in body
    ? new TextEncoder().encode(body.text)
    : Uint8Array.from(Buffer.from(body.base64, "base64"));
}
