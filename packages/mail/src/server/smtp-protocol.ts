import {
  MailboxAddressSchema,
  extractEmailAddress,
} from "@shepherdjerred/ops-model/email/mailbox.ts";

export const MAX_SMTP_MESSAGE_BYTES = 26_214_400;
export const MAX_SMTP_RECIPIENTS = 50;
export const MAX_SMTP_COMMAND_LINE_BYTES = 8192;

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/u;
const CRLF_DOT_CRLF = Buffer.from("\r\n.\r\n");

export function formatEhloResponse(options: {
  readonly hostname: string;
  readonly advertiseStartTls: boolean;
  readonly advertiseAuth: boolean;
}): string {
  const extensions: string[] = [
    options.hostname,
    "8BITMIME",
    "PIPELINING",
    "SMTPUTF8",
    `SIZE ${String(MAX_SMTP_MESSAGE_BYTES)}`,
  ];
  if (options.advertiseStartTls) {
    extensions.push("STARTTLS");
  }
  if (options.advertiseAuth) {
    extensions.push("AUTH PLAIN LOGIN");
  }

  return extensions
    .map((ext, index) =>
      index < extensions.length - 1 ? `250-${ext}\r\n` : `250 ${ext}\r\n`,
    )
    .join("");
}

export function decodeBase64Utf8(encoded: string): string | null {
  const trimmed = encoded.trim();
  if (trimmed === "=") {
    return "";
  }
  return trimmed.length === 0 ||
    trimmed.length % 4 !== 0 ||
    !BASE64_PATTERN.test(trimmed)
    ? null
    : Buffer.from(trimmed, "base64").toString("utf8");
}

export function decodeAuthPlainCredentials(
  encoded: string,
): { readonly username: string; readonly password: string } | null {
  const decoded = decodeBase64Utf8(encoded);
  if (decoded === null || decoded.length === 0) {
    return null;
  }
  const parts = decoded.split("\0");
  if (parts.length !== 3) {
    return null;
  }
  const [authzid, username, password] = parts;
  if (
    authzid === undefined ||
    username === undefined ||
    password === undefined
  ) {
    return null;
  }
  if (authzid !== username && authzid.length > 0) {
    return null;
  }
  return username.length === 0 || password.length === 0
    ? null
    : { username, password };
}

export type ParsedEnvelopeCommand =
  | {
      readonly kind: "ok";
      readonly address: string;
      readonly declaredSize: number | null;
    }
  | { readonly kind: "invalid_syntax" }
  | { readonly kind: "invalid_address" };

function extractBracketOrBarePart(remainder: string): {
  readonly rawAddress: string;
  readonly paramsTokens: string[];
} | null {
  const trimmed = remainder.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.startsWith("<")) {
    const closeIdx = trimmed.indexOf(">");
    if (closeIdx === -1) {
      return null;
    }
    const rawAddress = trimmed.slice(1, closeIdx).trim();
    const tail = trimmed.slice(closeIdx + 1).trim();
    const paramsTokens = tail.length > 0 ? tail.split(/\s+/u) : [];
    return { rawAddress, paramsTokens };
  }
  const tokens = trimmed.split(/\s+/u);
  const first = tokens[0];
  return first === undefined
    ? null
    : { rawAddress: first, paramsTokens: tokens.slice(1) };
}

export function parseEnvelopeAddressCommand(
  arg: string,
  expectedPrefix: "FROM:" | "TO:",
): ParsedEnvelopeCommand {
  if (arg.length < expectedPrefix.length) {
    return { kind: "invalid_syntax" };
  }
  const prefix = arg.slice(0, expectedPrefix.length).toUpperCase();
  if (prefix !== expectedPrefix) {
    return { kind: "invalid_syntax" };
  }
  const extracted = extractBracketOrBarePart(arg.slice(expectedPrefix.length));
  if (extracted === null) {
    return { kind: "invalid_syntax" };
  }
  if (extracted.rawAddress.length === 0) {
    return { kind: "invalid_address" };
  }

  const parsedMailbox = MailboxAddressSchema.safeParse(extracted.rawAddress);
  if (!parsedMailbox.success) {
    return { kind: "invalid_address" };
  }
  const address = extractEmailAddress(parsedMailbox.data);

  let declaredSize: number | null = null;
  for (const token of extracted.paramsTokens) {
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const paramName = token.slice(0, eqIdx).toUpperCase();
      const paramValue = token.slice(eqIdx + 1);
      if (paramName === "SIZE") {
        if (!/^\d+$/u.test(paramValue)) {
          return { kind: "invalid_syntax" };
        }
        declaredSize = Number(paramValue);
      }
    }
  }

  return { kind: "ok", address, declaredSize };
}

export type DataExtractResult =
  | {
      readonly kind: "incomplete";
      readonly retainedBuffer: Buffer;
      readonly overflowed: boolean;
    }
  | {
      readonly kind: "complete";
      readonly rawMime: Uint8Array;
      readonly remainingBuffer: Buffer;
      readonly overflowed: boolean;
    };

export function unstuffSmtpData(rawData: Buffer): Uint8Array {
  if (rawData.length === 0) {
    return new Uint8Array(0);
  }
  const out: number[] = [];
  let index = 0;
  let atLineStart = true;

  while (index < rawData.length) {
    const byte = rawData[index] ?? 0;
    if (
      atLineStart &&
      byte === 0x2e &&
      index + 1 < rawData.length &&
      rawData[index + 1] === 0x2e
    ) {
      index += 1;
      out.push(0x2e);
      atLineStart = false;
      index += 1;
      continue;
    }

    out.push(byte);
    atLineStart = byte === 0x0a && index > 0 && rawData[index - 1] === 0x0d;
    index += 1;
  }

  return Uint8Array.from(out);
}

export function extractSmtpDataFrame(
  buffer: Buffer,
  alreadyOverflowed: boolean,
): DataExtractResult {
  if (
    !alreadyOverflowed &&
    buffer.length >= 3 &&
    buffer[0] === 0x2e &&
    buffer[1] === 0x0d &&
    buffer[2] === 0x0a
  ) {
    return {
      kind: "complete",
      rawMime: new Uint8Array(0),
      remainingBuffer: Buffer.from(buffer.subarray(3)),
      overflowed: false,
    };
  }

  const endIdx = buffer.indexOf(CRLF_DOT_CRLF);
  if (endIdx !== -1) {
    const remainingBuffer = Buffer.from(buffer.subarray(endIdx + 5));
    if (alreadyOverflowed) {
      return {
        kind: "complete",
        rawMime: new Uint8Array(0),
        remainingBuffer,
        overflowed: true,
      };
    }
    const stuffedPayload = buffer.subarray(0, endIdx + 2);
    const rawMime = unstuffSmtpData(stuffedPayload);
    return {
      kind: "complete",
      rawMime,
      remainingBuffer,
      overflowed: rawMime.byteLength > MAX_SMTP_MESSAGE_BYTES,
    };
  }

  if (alreadyOverflowed || buffer.length > MAX_SMTP_MESSAGE_BYTES + 5) {
    const tailLength = Math.min(4, buffer.length);
    return {
      kind: "incomplete",
      retainedBuffer: Buffer.from(buffer.subarray(buffer.length - tailLength)),
      overflowed: true,
    };
  }

  return {
    kind: "incomplete",
    retainedBuffer: buffer,
    overflowed: false,
  };
}
