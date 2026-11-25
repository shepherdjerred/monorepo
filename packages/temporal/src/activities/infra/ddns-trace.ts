import https from "node:https";
import { isIP } from "node:net";
import { z } from "zod/v4";
import { log } from "#observability/log.ts";

const IPV4_TRACE_URL = "https://1.1.1.1/cdn-cgi/trace";
const IPV6_TRACE_URL = "https://[2606:4700:4700::1111]/cdn-cgi/trace";
const TRACE_TIMEOUT_MS = 15_000;

const IPV6_UNAVAILABLE_CODES = new Set([
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EADDRNOTAVAIL",
  "EAFNOSUPPORT",
]);

export type IpTraceTransport = (family: 4 | 6) => Promise<string>;

const ErrorCodeSchema = z.object({
  code: z.string().optional(),
  cause: z.object({ code: z.string().optional() }).optional(),
});

function extractErrorCode(error: unknown): string | undefined {
  const parsed = ErrorCodeSchema.safeParse(error);
  return parsed.success
    ? (parsed.data.code ?? parsed.data.cause?.code)
    : undefined;
}

function isIpv6UnavailableError(error: unknown): boolean {
  const code = extractErrorCode(error);
  if (code !== undefined && IPV6_UNAVAILABLE_CODES.has(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  for (const unavailableCode of IPV6_UNAVAILABLE_CODES) {
    if (message.includes(unavailableCode)) {
      return true;
    }
  }
  return false;
}

export function parseCloudflareTraceIp(
  traceBody: string,
  expectedFamily: 4 | 6,
): string {
  for (const rawLine of traceBody.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("ip=")) {
      continue;
    }
    const candidate = line.slice(3).trim();
    if (isIP(candidate) !== expectedFamily) {
      throw new Error(
        `Cloudflare trace returned "${candidate}", expected IPv${String(expectedFamily)}`,
      );
    }
    return candidate;
  }
  throw new Error(
    `Cloudflare trace response did not contain an ip= field for IPv${String(expectedFamily)}`,
  );
}

export type TraceResponseStream = {
  readonly complete: boolean;
  readonly statusCode?: number | undefined;
  readonly on: {
    (event: "data", listener: (chunk: Buffer) => void): unknown;
    (event: "end" | "close", listener: () => void): unknown;
    (event: "error", listener: (error: Error) => void): unknown;
  };
};

function attachTraceResponseHandlers(input: {
  readonly response: TraceResponseStream;
  readonly family: 4 | 6;
  readonly resolve: (body: string) => void;
  readonly reject: (error: Error) => void;
}): void {
  const { response, family, resolve, reject } = input;
  const chunks: Buffer[] = [];
  response.on("error", (error) => {
    reject(error);
  });
  response.on("close", () => {
    if (!response.complete) {
      reject(
        new Error(
          `Cloudflare IPv${String(family)} trace response closed before completion`,
        ),
      );
    }
  });
  response.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  response.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    if (
      response.statusCode === undefined ||
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      reject(
        new Error(
          `Cloudflare IPv${String(family)} trace returned HTTP ${String(response.statusCode)}`,
        ),
      );
      return;
    }
    resolve(body);
  });
}

export function readTraceResponse(
  response: TraceResponseStream,
  family: 4 | 6,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    attachTraceResponseHandlers({ response, family, resolve, reject });
  });
}

export function fetchPublicIpTrace(family: 4 | 6): Promise<string> {
  const targetUrl = new URL(family === 4 ? IPV4_TRACE_URL : IPV6_TRACE_URL);
  return new Promise<string>((resolve, reject) => {
    const request = https.request(
      targetUrl,
      {
        method: "GET",
        family,
        servername: "cloudflare-dns.com",
        timeout: TRACE_TIMEOUT_MS,
        headers: {
          "User-Agent": "temporal-ddns-sync/1.0",
          Accept: "text/plain",
        },
      },
      (response) => {
        attachTraceResponseHandlers({ response, family, resolve, reject });
      },
    );
    request.on("timeout", () => {
      request.destroy(
        new Error(`Cloudflare IPv${String(family)} trace timed out`),
      );
    });
    request.on("error", (error) => {
      reject(error);
    });
    request.end();
  });
}

export async function discoverPublicAddresses(
  traceTransport: IpTraceTransport,
): Promise<{ ipv4: string; ipv6: string | null }> {
  const ipv4Trace = await traceTransport(4);
  const ipv4 = parseCloudflareTraceIp(ipv4Trace, 4);

  let ipv6: string | null = null;
  try {
    const ipv6Trace = await traceTransport(6);
    ipv6 = parseCloudflareTraceIp(ipv6Trace, 6);
  } catch (error: unknown) {
    if (!isIpv6UnavailableError(error)) {
      throw error;
    }
    log(
      "info",
      "IPv6 connectivity unavailable during DDNS trace; skipping AAAA update",
      {
        module: "ddns",
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }

  return { ipv4, ipv6 };
}
