import {
  createTRPCClient,
  createTRPCUntypedClient,
  httpLink,
} from "@trpc/client";
import type { AppRouter } from "@shepherdjerred/tracker/contract";

export function trackerUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Tracker URL must be an HTTP(S) base URL without credentials, query, or fragment",
    );
  return url.toString().replace(/\/$/u, "");
}

const MAX_BODY_SNIPPET_LENGTH = 160;

function redactBodySecrets(text: string): string {
  return text
    .replaceAll(/\b(Bearer|Basic)\s+[^\s"',;<>]+/giu, "$1 [REDACTED]")
    .replaceAll(
      /\b(authorization|cookie|set-cookie)\s*:\s*[^\r\n"',;<>]+/giu,
      "$1: [REDACTED]",
    )
    .replaceAll(
      /\b(token|access_token|refresh_token|api[_-]?key|secret|password|session(?:[_-]?id)?)\s*([=:])\s*[^\s&"',;<>]+/giu,
      "$1$2[REDACTED]",
    )
    .replaceAll(/\bop:\/\/[^\s"',;<>]+/giu, "op://[REDACTED]");
}

function summarizeResponseBody(
  rawBody: string,
  contentType: string,
  parsedJson: boolean,
): { classification: string; snippet: string } {
  const trimmed = rawBody.trim();
  if (trimmed.length === 0) {
    return { classification: "empty", snippet: "" };
  }
  const isHtml =
    contentType.toLowerCase().includes("text/html") ||
    /<(?:!doctype|html|head|body|title|h1|p|div)\b/iu.test(trimmed);
  const stripped = isHtml
    ? trimmed
        .replaceAll(
          /<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu,
          " ",
        )
        .replaceAll(/<[^>]+>/gu, " ")
    : trimmed;
  const singleLine = redactBodySecrets(stripped)
    .replaceAll(/\s+/gu, " ")
    .trim();
  const snippet =
    singleLine.length > MAX_BODY_SNIPPET_LENGTH
      ? `${singleLine.slice(0, MAX_BODY_SNIPPET_LENGTH - 3)}...`
      : singleLine;
  const classification = isHtml
    ? "html"
    : parsedJson
      ? "non-trpc-json"
      : "text";
  return { classification, snippet };
}

function isTrpcEnvelope(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "result" in value
    ? typeof value.result === "object" && value.result !== null
    : "error" in value &&
        typeof value.error === "object" &&
        value.error !== null;
}

function buildInvalidTrpcResponseError(params: {
  status: number;
  contentType: string;
  method: string;
  rawBody: string;
  parsedJson?: boolean;
}): Error {
  const normalizedType =
    params.contentType.replaceAll(/\s+/gu, " ").trim() || "unknown";
  const parsedJson = params.parsedJson ?? false;
  const { classification, snippet } = summarizeResponseBody(
    params.rawBody,
    normalizedType,
    parsedJson,
  );
  const bodyDetail =
    snippet.length === 0
      ? `body=${classification}`
      : `body=${classification} ${JSON.stringify(snippet)}`;
  const reason = parsedJson
    ? "Tracker tRPC response was not a valid tRPC envelope"
    : "Tracker tRPC response was not valid JSON";
  const mutationWarning =
    params.method.toUpperCase() === "POST"
      ? " Mutation completion is uncertain; verify state via read-back before retrying."
      : "";
  return new Error(
    `${reason} (HTTP ${String(params.status)}, content-type: ${normalizedType}, ${bodyDetail}).${mutationWarning}`,
  );
}

function options(baseUrl: string, timeoutMs = 30_000) {
  return {
    links: [
      httpLink({
        url: `${trackerUrl(baseUrl)}/trpc`,
        fetch: async (url: string | URL, init) => {
          const method = init?.method ?? "GET";
          const response = await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
          });
          let bodyTextPromise: Promise<string> | undefined;
          const readText = (): Promise<string> => {
            bodyTextPromise ??= response.text();
            return bodyTextPromise;
          };
          return {
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            json: async (): Promise<unknown> => {
              const rawBody = await readText();
              const contentType = response.headers.get("content-type") ?? "";
              let parsed: unknown;
              try {
                parsed = JSON.parse(rawBody);
              } catch {
                throw buildInvalidTrpcResponseError({
                  status: response.status,
                  contentType,
                  method,
                  rawBody,
                });
              }
              if (!isTrpcEnvelope(parsed)) {
                throw buildInvalidTrpcResponseError({
                  status: response.status,
                  contentType,
                  method,
                  rawBody,
                  parsedJson: true,
                });
              }
              return parsed;
            },
            text: readText,
            body: null,
          };
        },
      }),
    ],
  };
}

export function trackerClient(baseUrl: string, timeoutMs?: number) {
  return createTRPCClient<AppRouter>(options(baseUrl, timeoutMs));
}
export function trackerApi(baseUrl: string) {
  return createTRPCUntypedClient(options(baseUrl));
}
export type TrackerClient = ReturnType<typeof trackerClient>;
