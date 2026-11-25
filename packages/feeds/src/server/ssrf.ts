import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { FeedSource } from "@shepherdjerred/feeds/shared/contract.ts";

export class SsrfBlockedError extends Error {
  override readonly name = "SsrfBlockedError";
}

export type SafeFetchFn = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export type SafeFetchOptions = {
  readonly headers?: Record<string, string> | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxBytes?: number | undefined;
  readonly maxRedirects?: number | undefined;
  readonly lookupHost?:
    ((hostname: string) => Promise<readonly string[]>) | undefined;
  readonly fetchImpl?: SafeFetchFn | undefined;
};

export type SafeFetchResult = {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
  readonly finalUrl: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FORBIDDEN_HOST_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
  ".cluster.local",
] as const;

const MAPPED_IPV4_DOTTED =
  /^(?:::ffff|(?:0{1,4}:){5}ffff):(\d{1,3}(?:\.\d{1,3}){3})$/iu;
const MAPPED_IPV4_HEX =
  /^(?:::ffff|(?:0{1,4}:){5}ffff):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu;

function createPrivateBlockList(): BlockList {
  const list = new BlockList();
  const ipv4Subnets: readonly (readonly [string, number])[] = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];
  for (const [net, prefix] of ipv4Subnets) {
    list.addSubnet(net, prefix, "ipv4");
  }
  const ipv6Subnets: readonly (readonly [string, number])[] = [
    ["::", 128],
    ["::1", 128],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];
  for (const [net, prefix] of ipv6Subnets) {
    list.addSubnet(net, prefix, "ipv6");
  }
  return list;
}

const PRIVATE_BLOCK_LIST = createPrivateBlockList();

function stripBracketsAndZone(raw: string): string {
  const trimmed = raw.trim();
  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  const zoneIndex = unbracketed.indexOf("%");
  return zoneIndex === -1 ? unbracketed : unbracketed.slice(0, zoneIndex);
}

function normalizeMappedIpv4(ip: string): string {
  const dottedMatch = MAPPED_IPV4_DOTTED.exec(ip);
  if (dottedMatch?.[1] !== undefined && isIP(dottedMatch[1]) === 4) {
    return dottedMatch[1];
  }
  const hexMatch = MAPPED_IPV4_HEX.exec(ip);
  if (hexMatch?.[1] !== undefined && hexMatch[2] !== undefined) {
    const hi = Number.parseInt(hexMatch[1], 16);
    const lo = Number.parseInt(hexMatch[2], 16);
    return `${String((hi >> 8) & 0xff)}.${String(hi & 0xff)}.${String((lo >> 8) & 0xff)}.${String(lo & 0xff)}`;
  }
  return ip;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = normalizeMappedIpv4(stripBracketsAndZone(ip));
  const version = isIP(normalized);
  return version === 4
    ? PRIVATE_BLOCK_LIST.check(normalized, "ipv4")
    : version !== 6 || PRIVATE_BLOCK_LIST.check(normalized, "ipv6");
}

async function defaultLookupHost(hostname: string): Promise<readonly string[]> {
  const records = await dnsLookup(hostname, { all: true, order: "verbatim" });
  return records.map((record) => record.address);
}

function isAllowedPort(protocol: string, port: string): boolean {
  if (port === "") {
    return true;
  }
  return protocol === "http:"
    ? port === "80"
    : protocol === "https:" && port === "443";
}

function isForbiddenHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replaceAll(/\.+$/gu, "");
  return (
    normalized === "localhost" ||
    normalized.length === 0 ||
    FORBIDDEN_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  );
}

function parseAndValidateUrlStructure(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("Invalid feed URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new SsrfBlockedError("Embedded URL credentials are not allowed");
  }
  if (!isAllowedPort(parsed.protocol, parsed.port)) {
    throw new SsrfBlockedError(
      `Non-default port is not allowed: ${parsed.port}`,
    );
  }
  if (isForbiddenHostname(parsed.hostname)) {
    throw new SsrfBlockedError(`Forbidden hostname: ${parsed.hostname}`);
  }
  return parsed;
}

async function validateResolvedAddresses(
  hostname: string,
  lookupHost: (host: string) => Promise<readonly string[]>,
): Promise<void> {
  const bareHost = stripBracketsAndZone(hostname);
  if (isIP(bareHost) !== 0) {
    if (isPrivateOrReservedIp(bareHost)) {
      throw new SsrfBlockedError(
        `Blocked private or reserved IP literal: ${bareHost}`,
      );
    }
    return;
  }
  const normalizedHost = hostname.toLowerCase().replaceAll(/\.+$/gu, "");
  let addresses: readonly string[];
  try {
    addresses = await lookupHost(normalizedHost);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "DNS failure";
    throw new SsrfBlockedError(
      `DNS lookup failed for ${normalizedHost}: ${reason}`,
    );
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(
      `DNS lookup returned no records for ${normalizedHost}`,
    );
  }
  for (const address of addresses) {
    if (isPrivateOrReservedIp(address)) {
      throw new SsrfBlockedError(
        `Blocked private or reserved IP ${address} for ${normalizedHost}`,
      );
    }
  }
}

async function cancelQuietly(
  action: Promise<unknown> | undefined,
): Promise<void> {
  if (action === undefined) {
    return;
  }
  try {
    await action;
  } catch {
    // Best-effort stream cancellation
  }
}

async function readStreamBounded(
  response: Response,
  maxBytes: number,
  abortController: AbortController,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/u.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (declaredBytes > maxBytes) {
      abortController.abort();
      await cancelQuietly(response.body?.cancel());
      throw new Error(
        `Response Content-Length (${String(declaredBytes)}) exceeds limit of ${String(maxBytes)} bytes`,
      );
    }
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        abortController.abort();
        await cancelQuietly(reader.cancel());
        throw new Error(
          `Response body exceeded maximum size of ${String(maxBytes)} bytes`,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of chunks) {
    combined.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8").decode(combined);
}

async function resolveNextRedirectUrl(
  response: Response,
  currentParsed: URL,
  hop: number,
  maxRedirects: number,
): Promise<string | undefined> {
  if (!REDIRECT_STATUSES.has(response.status)) {
    return undefined;
  }
  const location = response.headers.get("location");
  await cancelQuietly(response.body?.cancel());
  if (location === null || location.trim().length === 0) {
    return undefined;
  }
  if (hop >= maxRedirects) {
    throw new SsrfBlockedError(
      `Exceeded maximum redirects (${String(maxRedirects)})`,
    );
  }
  try {
    return new URL(location, currentParsed).toString();
  } catch {
    throw new SsrfBlockedError("Invalid redirect Location URL");
  }
}

export async function safeFetch(
  url: string,
  options?: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookupHost = options?.lookupHost ?? defaultLookupHost;
  const fetchImpl: SafeFetchFn = options?.fetchImpl ?? fetch;

  const abortController = new AbortController();
  const signal = AbortSignal.any([
    abortController.signal,
    AbortSignal.timeout(timeoutMs),
  ]);

  let currentUrl = url;
  for (let hop = 0; ; hop += 1) {
    const parsed = parseAndValidateUrlStructure(currentUrl);
    await validateResolvedAddresses(parsed.hostname, lookupHost);

    const requestInit: RequestInit = {
      method: "GET",
      redirect: "manual",
      signal,
      ...(options?.headers === undefined ? {} : { headers: options.headers }),
    };
    const response = await fetchImpl(parsed.toString(), requestInit);
    const nextUrl = await resolveNextRedirectUrl(
      response,
      parsed,
      hop,
      maxRedirects,
    );
    if (nextUrl !== undefined) {
      currentUrl = nextUrl;
      continue;
    }

    const body = await readStreamBounded(response, maxBytes, abortController);
    return {
      status: response.status,
      headers: response.headers,
      body,
      finalUrl: parsed.toString(),
    };
  }
}

function redactFallbackString(rawUrl: string): string {
  const withoutAuth = rawUrl.replace(/:\/\/[^/?#@]+@/u, "://");
  return withoutAuth.replace(/\?[^#]*/u, "?[REDACTED]");
}

export function redactUrlForDisplay(
  rawUrl: string,
  source: FeedSource,
): string {
  if (source !== "user") {
    return rawUrl;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return redactFallbackString(rawUrl);
  }
  const hasCredentials =
    parsed.username.length > 0 || parsed.password.length > 0;
  const hasSearch = parsed.search.length > 0;
  if (!hasCredentials && !hasSearch) {
    return rawUrl;
  }
  return `${parsed.origin}${parsed.pathname}${hasSearch ? "?[REDACTED]" : ""}${parsed.hash}`;
}

function sanitizeParsedUrlSecrets(
  message: string,
  rawUrl: string,
  parsed: URL,
): string {
  let sanitized = message;
  const hasSecrets =
    parsed.search.length > 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0;
  if (hasSecrets) {
    const redacted = redactUrlForDisplay(rawUrl, "user");
    sanitized = sanitized.replaceAll(rawUrl, redacted);
    sanitized = sanitized.replaceAll(parsed.toString(), redacted);
  }
  if (parsed.search.length > 0) {
    sanitized = sanitized.replaceAll(parsed.search, "?[REDACTED]");
    const rawQuery = parsed.search.slice(1);
    if (rawQuery.length > 0) {
      sanitized = sanitized.replaceAll(rawQuery, "[REDACTED]");
    }
  }
  if (parsed.password.length > 0) {
    sanitized = sanitized.replaceAll(
      `${parsed.username}:${parsed.password}`,
      "[REDACTED]",
    );
    sanitized = sanitized.replaceAll(parsed.password, "[REDACTED]");
  }
  return sanitized;
}

export function sanitizeErrorMessage(message: string, rawUrl: string): string {
  try {
    return sanitizeParsedUrlSecrets(message, rawUrl, new URL(rawUrl));
  } catch {
    const queryStart = rawUrl.indexOf("?");
    if (queryStart === -1) {
      return message;
    }
    const hashStart = rawUrl.indexOf("#", queryStart);
    const rawQuery =
      hashStart === -1
        ? rawUrl.slice(queryStart + 1)
        : rawUrl.slice(queryStart + 1, hashStart);
    const next = message.replaceAll(rawUrl, redactFallbackString(rawUrl));
    return rawQuery.length > 0
      ? next
          .replaceAll(`?${rawQuery}`, "?[REDACTED]")
          .replaceAll(rawQuery, "[REDACTED]")
      : next;
  }
}
