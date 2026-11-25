import nodemailer from "nodemailer";
import PostalMime, { type Address } from "postal-mime";
import {
  MailboxAddressSchema,
  extractEmailAddress,
} from "@shepherdjerred/ops-model/email/mailbox.ts";
import type { SendMessageRequest } from "@shepherdjerred/mail/shared/contract.ts";

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^`|~\w]+$/u;
const RESERVED_HEADERS = new Set([
  "from",
  "to",
  "subject",
  "message-id",
  "mime-version",
  "content-type",
  "content-transfer-encoding",
]);

const streamTransporter = nodemailer.createTransport({
  streamTransport: true,
  buffer: true,
  newline: "windows",
});

export type SynthesizedMimeMessage = {
  readonly rfcMessageId: string;
  readonly mailFrom: string;
  readonly recipients: string[];
  readonly fromHeader: string;
  readonly toHeader: string;
  readonly subject: string;
  readonly plainBody: string | null;
  readonly htmlBody: string | null;
  readonly headers: Record<string, string>;
  readonly rawMime: Uint8Array;
};

export type ParsedInboundMimeMessage = {
  readonly fromHeader: string;
  readonly toHeader: string;
  readonly fromAddress: string | null;
  readonly subject: string;
  readonly rfcMessageId: string;
  readonly plainBody: string | null;
  readonly htmlBody: string | null;
  readonly tag: string | null;
  readonly headers: Record<string, string>;
};

export function normalizeRfcMessageId(
  rawMessageId: string | undefined,
  defaultDomain = "sjer.red",
): string {
  if (rawMessageId === undefined || rawMessageId.trim().length === 0) {
    return `<${crypto.randomUUID()}@${defaultDomain}>`;
  }
  const trimmed = rawMessageId.trim();
  if (/[\r\n]/u.test(trimmed)) {
    throw new Error("Message-ID must not contain CR or LF characters");
  }
  const stripped = trimmed.replace(/^<+/u, "").replace(/>+$/u, "").trim();
  if (stripped.length === 0 || /\s/u.test(stripped)) {
    throw new Error(`Invalid Message-ID: ${rawMessageId}`);
  }
  return `<${stripped}>`;
}

function sanitizeCustomHeaders(
  customHeaders: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (customHeaders === undefined) {
    return {};
  }
  const sanitized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(customHeaders)) {
    const key = rawKey.trim();
    if (!HEADER_NAME_PATTERN.test(key)) {
      throw new Error(`Invalid custom header name: ${rawKey}`);
    }
    if (RESERVED_HEADERS.has(key.toLowerCase())) {
      throw new Error(`Reserved header cannot be overridden: ${key}`);
    }
    if (/[\r\n]/u.test(rawValue)) {
      throw new Error(`Header value for ${key} must not contain CR or LF`);
    }
    sanitized[key] = rawValue;
  }
  return sanitized;
}

export async function synthesizeMimeMessage(
  input: SendMessageRequest,
  defaultDomain = "sjer.red",
): Promise<SynthesizedMimeMessage> {
  if (/[\r\n]/u.test(input.subject)) {
    throw new Error("Subject must not contain CR or LF characters");
  }
  const validatedFrom = MailboxAddressSchema.parse(input.from);
  const mailFrom = extractEmailAddress(validatedFrom);
  const validatedToList = input.to.map((recipient) =>
    MailboxAddressSchema.parse(recipient),
  );
  const recipients = validatedToList.map((recipient) =>
    extractEmailAddress(recipient),
  );
  const rfcMessageId = normalizeRfcMessageId(input.messageId, defaultDomain);
  const customHeaders = sanitizeCustomHeaders(input.headers);
  if (input.tag !== undefined && customHeaders["X-Mail-Tag"] === undefined) {
    if (/[\r\n]/u.test(input.tag)) {
      throw new Error("Tag must not contain CR or LF characters");
    }
    customHeaders["X-Mail-Tag"] = input.tag;
  }

  const info = await streamTransporter.sendMail({
    from: validatedFrom,
    to: validatedToList.join(", "),
    subject: input.subject,
    messageId: rfcMessageId,
    ...(input.plainBody === undefined ? {} : { text: input.plainBody }),
    ...(input.htmlBody === undefined ? {} : { html: input.htmlBody }),
    headers: customHeaders,
  });

  if (!Buffer.isBuffer(info.message)) {
    throw new TypeError("Expected Buffer output from streamTransport");
  }

  const rawMime = new Uint8Array(info.message);
  const parsedBack = await PostalMime.parse(rawMime);
  const allHeaders: Record<string, string> = {};
  for (const header of parsedBack.headers) {
    const existing = allHeaders[header.key];
    allHeaders[header.key] =
      existing === undefined ? header.value : `${existing}, ${header.value}`;
  }

  return {
    rfcMessageId,
    mailFrom,
    recipients,
    fromHeader: validatedFrom,
    toHeader: validatedToList.join(", "),
    subject: input.subject,
    plainBody: input.plainBody ?? null,
    htmlBody: input.htmlBody ?? null,
    headers: allHeaders,
    rawMime,
  };
}

function formatParsedAddress(address: Address): string {
  if (address.address !== undefined) {
    return address.name.length > 0
      ? `${address.name} <${address.address}>`
      : address.address;
  }
  return address.group
    .map((member) =>
      member.name.length > 0
        ? `${member.name} <${member.address}>`
        : member.address,
    )
    .join(", ");
}

function extractPrimaryAddress(address: Address | undefined): string | null {
  if (address === undefined) {
    return null;
  }
  if (address.address !== undefined) {
    return address.address.length > 0 ? address.address : null;
  }
  const firstGroupMember = address.group[0];
  return firstGroupMember !== undefined && firstGroupMember.address.length > 0
    ? firstGroupMember.address
    : null;
}

export async function parseInboundMime(
  rawMime: Uint8Array,
  fallbackIdDomain = "sjer.red",
): Promise<ParsedInboundMimeMessage> {
  const parsed = await PostalMime.parse(rawMime);
  const headers: Record<string, string> = {};
  for (const header of parsed.headers) {
    const existing = headers[header.key];
    headers[header.key] =
      existing === undefined ? header.value : `${existing}, ${header.value}`;
  }

  const fromAddress = extractPrimaryAddress(parsed.from);
  const fromHeader =
    headers["from"] ??
    (parsed.from === undefined ? "" : formatParsedAddress(parsed.from));
  const toHeader =
    headers["to"] ??
    (parsed.to === undefined
      ? ""
      : parsed.to.map((entry) => formatParsedAddress(entry)).join(", "));
  const rfcMessageId = normalizeRfcMessageId(
    parsed.messageId,
    fallbackIdDomain,
  );
  const rawTag = headers["x-mail-tag"];
  const tag =
    rawTag !== undefined && rawTag.trim().length > 0
      ? rawTag.trim().slice(0, 256)
      : null;

  return {
    fromHeader,
    toHeader,
    fromAddress,
    subject: parsed.subject ?? "",
    rfcMessageId,
    plainBody: parsed.text ?? null,
    htmlBody: parsed.html ?? null,
    tag,
    headers,
  };
}
