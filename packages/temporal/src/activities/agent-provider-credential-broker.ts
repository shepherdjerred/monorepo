import { timingSafeEqual } from "node:crypto";
import type { AgentTaskProvider } from "#shared/agent-task.ts";

const PROVIDER_UPSTREAMS: Record<AgentTaskProvider, string> = {
  claude: "https://api.anthropic.com",
  codex: "https://api.openai.com",
};

const PROVIDER_PATHS: Record<AgentTaskProvider, ReadonlySet<string>> = {
  claude: new Set(["/v1/messages", "/v1/messages/count_tokens"]),
  codex: new Set(["/v1/responses"]),
};

const STRIPPED_REQUEST_HEADERS = [
  "authorization",
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "transfer-encoding",
  "x-api-key",
] as const;

const STRIPPED_RESPONSE_HEADERS = [
  "connection",
  "content-length",
  "transfer-encoding",
] as const;

export type AgentProviderCredentialBroker = {
  baseUrl: string;
  clientToken: string;
  stop: () => Promise<void>;
};

export type AgentProviderCredentialBrokerFactory = (
  provider: AgentTaskProvider,
) => AgentProviderCredentialBroker;

export type AgentProviderCredentialBrokerOptions = {
  sourceEnv?: Readonly<Record<string, string | undefined>>;
  upstreamBaseUrl?: string;
};

function providerCredential(
  provider: AgentTaskProvider,
  sourceEnv: Readonly<Record<string, string | undefined>>,
): string {
  const credential =
    provider === "claude"
      ? sourceEnv["CLAUDE_CODE_OAUTH_TOKEN"]
      : (sourceEnv["CODEX_API_KEY"] ?? sourceEnv["OPENAI_API_KEY"]);
  if (credential === undefined || credential === "") {
    throw new Error(
      provider === "claude"
        ? "CLAUDE_CODE_OAUTH_TOKEN is required for Claude agent tasks"
        : "CODEX_API_KEY or OPENAI_API_KEY is required for Codex agent tasks",
    );
  }
  return credential;
}

function bearerToken(header: string | null): string | undefined {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) === true
    ? header.slice(prefix.length)
    : undefined;
}

function tokenMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) return false;
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return (
    presentedBytes.length === expectedBytes.length &&
    timingSafeEqual(presentedBytes, expectedBytes)
  );
}

function requestHeaders(request: Request, providerCredentialValue: string) {
  const headers = new Headers(request.headers);
  for (const header of STRIPPED_REQUEST_HEADERS) headers.delete(header);
  headers.set("authorization", `Bearer ${providerCredentialValue}`);
  return headers;
}

function responseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  for (const header of STRIPPED_RESPONSE_HEADERS) headers.delete(header);
  return headers;
}

function brokerError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function requiredServerPort(port: number | undefined): number {
  if (port === undefined) {
    throw new Error("agent provider credential broker did not bind a port");
  }
  return port;
}

export function startAgentProviderCredentialBroker(
  provider: AgentTaskProvider,
  options: AgentProviderCredentialBrokerOptions = {},
): AgentProviderCredentialBroker {
  const credential = providerCredential(provider, options.sourceEnv ?? Bun.env);
  const upstreamBaseUrl =
    options.upstreamBaseUrl ?? PROVIDER_UPSTREAMS[provider];
  const clientToken = `agent-provider-broker-${crypto.randomUUID()}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (
        !tokenMatches(
          bearerToken(request.headers.get("authorization")),
          clientToken,
        )
      ) {
        return brokerError(401, "unauthorized");
      }
      if (request.method !== "POST") {
        return brokerError(405, "method not allowed");
      }
      const requestUrl = new URL(request.url);
      if (!PROVIDER_PATHS[provider].has(requestUrl.pathname)) {
        return brokerError(403, "provider path not allowed");
      }
      const upstreamUrl = new URL(
        `${requestUrl.pathname}${requestUrl.search}`,
        upstreamBaseUrl,
      );
      try {
        const upstream = await fetch(upstreamUrl, {
          method: "POST",
          headers: requestHeaders(request, credential),
          body: await request.arrayBuffer(),
          redirect: "error",
          signal: request.signal,
        });
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders(upstream),
        });
      } catch (error: unknown) {
        console.warn(
          JSON.stringify({
            level: "error",
            msg: "Agent provider credential broker upstream request failed",
            component: "agent-provider-credential-broker",
            provider,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return brokerError(502, "provider upstream unavailable");
      }
    },
  });
  const port = requiredServerPort(server.port);

  return {
    baseUrl: `http://127.0.0.1:${port.toString()}`,
    clientToken,
    async stop() {
      await server.stop();
    },
  };
}
