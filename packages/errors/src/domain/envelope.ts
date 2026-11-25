import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";
import { z } from "zod";
import {
  JsonObjectSchema,
  normalizeSentryEventPayload,
  type NormalizedSdkInfo,
  type NormalizedSentryEvent,
} from "#domain/envelope-normalize.ts";

export const MAX_COMPRESSED_BYTES = 1 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;

const EnvelopeHeaderSchema = z
  .object({
    event_id: z.string().optional(),
    dsn: z.string().optional(),
    sent_at: z.string().optional(),
    sdk: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
      })
      .optional(),
  })
  .loose();

const EnvelopeItemHeaderSchema = z
  .object({
    type: z.string().min(1),
    length: z.number().int().nonnegative().optional(),
    content_type: z.string().optional(),
  })
  .loose();

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export class MalformedEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedEnvelopeError";
  }
}

export type ParsedEnvelopeResult = {
  readonly publicKey: string | null;
  readonly event: NormalizedSentryEvent | null;
  readonly ignoredItemTypes: string[];
};

export type ParseEnvelopeOptions = {
  readonly sentryAuthHeader?: string | undefined;
  readonly authorizationHeader?: string | undefined;
  readonly querySentryKey?: string | undefined;
  readonly contentType?: string | undefined;
};

function isOutputTooLargeError(error: unknown): boolean {
  if (error instanceof RangeError) {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg.includes("maxOutputLength") ||
      msg.includes("Cannot create a Buffer larger than") ||
      msg.includes("ERR_BUFFER_TOO_LARGE") ||
      msg.includes("Output length exceed")
    );
  }
  return false;
}

function inflateDeflateBounded(rawBytes: Uint8Array): Uint8Array {
  try {
    return new Uint8Array(
      inflateSync(rawBytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
    );
  } catch (firstError) {
    if (isOutputTooLargeError(firstError)) {
      throw new PayloadTooLargeError(
        "Decompressed deflate payload exceeds 2 MiB limit.",
      );
    }
    return new Uint8Array(
      inflateRawSync(rawBytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
    );
  }
}

export function decompressEnvelopePayload(
  rawBytes: Uint8Array,
  contentEncoding = "identity",
): Uint8Array {
  if (rawBytes.byteLength > MAX_COMPRESSED_BYTES) {
    throw new PayloadTooLargeError(
      "Compressed envelope payload exceeds 1 MiB limit.",
    );
  }
  const encoding = contentEncoding.trim().toLowerCase();
  if (encoding === "" || encoding === "identity") {
    return rawBytes;
  }

  let output: Uint8Array;
  try {
    switch (encoding) {
      case "gzip":
      case "x-gzip": {
        output = new Uint8Array(
          gunzipSync(rawBytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES }),
        );
        break;
      }
      case "br": {
        output = new Uint8Array(
          brotliDecompressSync(rawBytes, {
            maxOutputLength: MAX_DECOMPRESSED_BYTES,
          }),
        );
        break;
      }
      case "deflate": {
        output = inflateDeflateBounded(rawBytes);
        break;
      }
      default: {
        throw new MalformedEnvelopeError(
          `Unsupported Content-Encoding: ${encoding}`,
        );
      }
    }
  } catch (error) {
    if (
      error instanceof PayloadTooLargeError ||
      error instanceof MalformedEnvelopeError
    ) {
      throw error;
    }
    if (isOutputTooLargeError(error)) {
      throw new PayloadTooLargeError(
        "Decompressed envelope payload exceeds 2 MiB limit.",
      );
    }
    throw new MalformedEnvelopeError("Failed to decompress envelope payload.");
  }

  if (output.byteLength > MAX_DECOMPRESSED_BYTES) {
    throw new PayloadTooLargeError(
      "Decompressed envelope payload exceeds 2 MiB limit.",
    );
  }
  return output;
}

function extractSentryAuthKey(headerValue: string | undefined): string | null {
  if (headerValue === undefined) {
    return null;
  }
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const withoutPrefix = trimmed.replace(/^sentry\s+/iu, "");
  for (const part of withoutPrefix.split(",")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex !== -1) {
      const key = part.slice(0, eqIndex).trim().toLowerCase();
      const value = part
        .slice(eqIndex + 1)
        .trim()
        .replaceAll(/^"|"$/gu, "");
      if (key === "sentry_key" && value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

export function extractPublicKey(options: {
  readonly dsn?: string | undefined;
  readonly sentryAuthHeader?: string | undefined;
  readonly authorizationHeader?: string | undefined;
  readonly querySentryKey?: string | undefined;
}): string | null {
  if (options.dsn !== undefined && options.dsn.trim().length > 0) {
    try {
      const parsed = new URL(options.dsn);
      if (parsed.username.length > 0) {
        return decodeURIComponent(parsed.username);
      }
    } catch {
      // Fall through to header/query inspection
    }
  }

  const fromSentryAuth = extractSentryAuthKey(options.sentryAuthHeader);
  if (fromSentryAuth !== null) {
    return fromSentryAuth;
  }

  if (
    options.authorizationHeader !== undefined &&
    /^sentry\s+/iu.test(options.authorizationHeader.trim())
  ) {
    const fromAuth = extractSentryAuthKey(options.authorizationHeader);
    if (fromAuth !== null) {
      return fromAuth;
    }
  }

  if (options.querySentryKey !== undefined) {
    const queryKey = options.querySentryKey.trim();
    if (queryKey.length > 0) {
      return queryKey;
    }
  }

  return null;
}

function parseJsonObjectBytes(
  bytes: Uint8Array,
  decoder: TextDecoder,
  label: string,
): Record<string, unknown> {
  const text = decoder.decode(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MalformedEnvelopeError(`Invalid JSON in ${label}.`);
  }
  const parsed = JsonObjectSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MalformedEnvelopeError(`${label} must be a JSON object.`);
  }
  return parsed.data;
}

function readLineBytes(
  bytes: Uint8Array,
  startOffset: number,
): { readonly lineBytes: Uint8Array; readonly nextOffset: number } {
  let end = bytes.indexOf(0x0a, startOffset);
  let nextOffset: number;
  if (end === -1) {
    end = bytes.byteLength;
    nextOffset = bytes.byteLength;
  } else {
    nextOffset = end + 1;
  }
  const sliceEnd = end > startOffset && bytes[end - 1] === 0x0d ? end - 1 : end;
  return {
    lineBytes: bytes.subarray(startOffset, sliceEnd),
    nextOffset,
  };
}

function readItemPayloadBytes(
  bytes: Uint8Array,
  startOffset: number,
  declaredLength: number | undefined,
): { readonly payloadBytes: Uint8Array; readonly nextOffset: number } {
  if (declaredLength !== undefined) {
    const endOffset = startOffset + declaredLength;
    if (endOffset > bytes.byteLength) {
      throw new MalformedEnvelopeError(
        "Envelope item payload truncated before declared byte length.",
      );
    }
    let nextOffset = endOffset;
    if (bytes[nextOffset] === 0x0d && bytes[nextOffset + 1] === 0x0a) {
      nextOffset += 2;
    } else if (bytes[nextOffset] === 0x0a) {
      nextOffset += 1;
    }
    return {
      payloadBytes: bytes.subarray(startOffset, endOffset),
      nextOffset,
    };
  }
  const line = readLineBytes(bytes, startOffset);
  return { payloadBytes: line.lineBytes, nextOffset: line.nextOffset };
}

function looksLikeStandaloneEventObject(obj: Record<string, unknown>): boolean {
  return (
    obj["exception"] !== undefined ||
    obj["message"] !== undefined ||
    obj["logentry"] !== undefined ||
    obj["stacktrace"] !== undefined ||
    obj["breadcrumbs"] !== undefined ||
    obj["level"] !== undefined
  );
}

function parseEnvelopeItems(options: {
  readonly rawBytes: Uint8Array;
  readonly initialOffset: number;
  readonly decoder: TextDecoder;
  readonly fallbackEventId: string | undefined;
  readonly fallbackSdk: NormalizedSdkInfo | null;
}): {
  readonly event: NormalizedSentryEvent | null;
  readonly ignoredItemTypes: string[];
} {
  let offset = options.initialOffset;
  let event: NormalizedSentryEvent | null = null;
  const ignoredItemTypes: string[] = [];

  while (offset < options.rawBytes.byteLength) {
    const itemLine = readLineBytes(options.rawBytes, offset);
    offset = itemLine.nextOffset;
    if (itemLine.lineBytes.byteLength === 0) {
      continue;
    }
    const rawItemHeader = parseJsonObjectBytes(
      itemLine.lineBytes,
      options.decoder,
      "envelope item header",
    );
    const itemHeaderResult = EnvelopeItemHeaderSchema.safeParse(rawItemHeader);
    if (!itemHeaderResult.success) {
      throw new MalformedEnvelopeError("Invalid envelope item header.");
    }
    const itemHeader = itemHeaderResult.data;
    const payload = readItemPayloadBytes(
      options.rawBytes,
      offset,
      itemHeader.length,
    );
    offset = payload.nextOffset;

    if (itemHeader.type === "event") {
      if (event === null) {
        const eventObj = parseJsonObjectBytes(
          payload.payloadBytes,
          options.decoder,
          "event item payload",
        );
        event = normalizeSentryEventPayload(
          eventObj,
          options.fallbackEventId,
          options.fallbackSdk,
        );
      }
    } else {
      ignoredItemTypes.push(itemHeader.type);
    }
  }

  return { event, ignoredItemTypes };
}

export function parseSentryEnvelope(
  rawBytes: Uint8Array,
  options?: ParseEnvelopeOptions,
): ParsedEnvelopeResult {
  if (rawBytes.byteLength === 0) {
    throw new MalformedEnvelopeError("Envelope body cannot be empty.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const firstLine = readLineBytes(rawBytes, 0);
  const firstObj = parseJsonObjectBytes(
    firstLine.lineBytes,
    decoder,
    "envelope header",
  );
  const parsedHeader = EnvelopeHeaderSchema.safeParse(firstObj);
  if (!parsedHeader.success) {
    throw new MalformedEnvelopeError("Invalid envelope header schema.");
  }
  const envelopeHeader = parsedHeader.data;
  const fallbackSdk: NormalizedSdkInfo | null =
    envelopeHeader.sdk === undefined
      ? null
      : {
          name: envelopeHeader.sdk.name ?? null,
          version: envelopeHeader.sdk.version ?? null,
        };

  const publicKey = extractPublicKey({
    dsn: envelopeHeader.dsn,
    sentryAuthHeader: options?.sentryAuthHeader,
    authorizationHeader: options?.authorizationHeader,
    querySentryKey: options?.querySentryKey,
  });

  const remainingTrimmed = decoder
    .decode(rawBytes.subarray(firstLine.nextOffset))
    .trim();
  if (
    remainingTrimmed.length === 0 &&
    looksLikeStandaloneEventObject(firstObj)
  ) {
    return {
      publicKey,
      event: normalizeSentryEventPayload(
        firstObj,
        envelopeHeader.event_id,
        fallbackSdk,
      ),
      ignoredItemTypes: [],
    };
  }

  const items = parseEnvelopeItems({
    rawBytes,
    initialOffset: firstLine.nextOffset,
    decoder,
    fallbackEventId: envelopeHeader.event_id,
    fallbackSdk,
  });
  return {
    publicKey,
    event: items.event,
    ignoredItemTypes: items.ignoredItemTypes,
  };
}
