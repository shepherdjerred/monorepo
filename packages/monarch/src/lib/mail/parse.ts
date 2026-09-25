import type { ParsedEmail } from "./types.ts";

// Pure RFC822 parsing: header unfolding, quoted-printable and base64
// decoding, nested multipart traversal, CRLF and LF tolerant. No filesystem
// access — callers hand in raw message text.

const BODY_CAP = 64 * 1024;

export function parseHeaders(raw: string): Record<string, string> {
  const headerEnd = findHeaderEnd(raw);
  const headerText = raw.slice(0, headerEnd);
  const headers: Record<string, string> = {};
  // Unfold continuation lines before splitting
  const unfolded = headerText.replaceAll(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!(name in headers)) {
      headers[name] = line.slice(colon + 1).trim();
    }
  }
  return headers;
}

function findHeaderEnd(raw: string): number {
  const crlf = raw.indexOf("\r\n\r\n");
  const lf = raw.indexOf("\n\n");
  if (crlf === -1) return lf === -1 ? raw.length : lf;
  return lf === -1 ? crlf : Math.min(crlf, lf);
}

function bodyOf(raw: string): string {
  const end = findHeaderEnd(raw);
  return raw.slice(end).replace(/^(?:\r?\n)+/, "");
}

export function decodeQuotedPrintable(text: string): string {
  const joined = text.replaceAll(/=\r?\n/g, ""); // soft line breaks
  // =XX escapes are raw bytes (often multi-byte UTF-8 sequences), so decode
  // through a byte buffer rather than per-byte characters.
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = /^=([0-9a-f]{2})/i.exec(joined.slice(i, i + 3));
    if (hex?.[1] !== undefined) {
      bytes.push(Number.parseInt(hex[1], 16));
      i += 2;
      continue;
    }
    const code = joined.codePointAt(i) ?? 0;
    if (code < 128) {
      bytes.push(code);
    } else {
      for (const b of new TextEncoder().encode(joined[i] ?? "")) bytes.push(b);
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(
    new Uint8Array(bytes),
  );
}

function decodeBody(body: string, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc.includes("quoted-printable")) return decodeQuotedPrintable(body);
  if (enc.includes("base64")) {
    try {
      return Buffer.from(body.replaceAll(/\s+/g, ""), "base64").toString(
        "utf8",
      );
    } catch {
      return "";
    }
  }
  return body;
}

export function stripHtml(html: string): string {
  return html
    .replaceAll(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

type Part = { contentType: string; encoding: string; body: string };

// Flattens (nested) multipart messages into leaf parts.
function collectParts(raw: string): Part[] {
  const headers = parseHeaders(raw);
  const contentType = headers["content-type"] ?? "text/plain";
  const encoding = headers["content-transfer-encoding"] ?? "";
  const body = bodyOf(raw);

  const boundaryMatch = /boundary="?([^";\r\n]+)"?/i.exec(contentType);
  if (!boundaryMatch || !contentType.toLowerCase().includes("multipart")) {
    return [{ contentType, encoding, body }];
  }

  const boundary = boundaryMatch[1] ?? "";
  const parts: Part[] = [];
  const segments = body.split(`--${boundary}`);
  // First segment is the preamble, a trailing "--" segment is the epilogue
  for (const segment of segments.slice(1)) {
    if (segment.startsWith("--")) break;
    parts.push(...collectParts(segment.replace(/^\r?\n/, "")));
  }
  return parts;
}

export function extractTextBody(raw: string): string {
  const parts = collectParts(raw);
  const plain = parts.find((p) =>
    p.contentType.toLowerCase().includes("text/plain"),
  );
  if (plain) {
    return decodeBody(plain.body, plain.encoding).slice(0, BODY_CAP);
  }
  const html = parts.find((p) =>
    p.contentType.toLowerCase().includes("text/html"),
  );
  return html
    ? stripHtml(decodeBody(html.body, html.encoding)).slice(0, BODY_CAP)
    : "";
}

export function parseEmailDateHeader(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : (parsed.toISOString().split("T")[0] ?? "");
}

export function parseEmail(raw: string): ParsedEmail {
  const headers = parseHeaders(raw);
  return {
    headers,
    from: headers["from"] ?? "",
    subject: headers["subject"] ?? "",
    date: parseEmailDateHeader(headers["date"] ?? ""),
    messageId: headers["message-id"] ?? "",
    textBody: extractTextBody(raw),
  };
}
