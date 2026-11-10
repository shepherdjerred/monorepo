import type { HistorySourceName } from "#lib/history/types.ts";

/**
 * Which coding-agent CLIs `brim capture` can wrap, how each one is made to
 * trust the capture CA, and which requests are recorded.
 *
 * Every row comes from the 2026-11-09 interception spike (mitmproxy 12.2.1,
 * observe-only). `verified` means a real prompt was captured through the
 * environment below; `tls-only` means the CLI trusted the CA and reached its
 * auth host but no inference was seen (no login on the test machine);
 * `unverified` means nothing was observed. Routes and correlation for every
 * CLI that is not `verified` come from binary strings or public docs, are
 * marked `verified: false`, and need one confirming run on a logged-in Mac
 * (see the "Capture raw agent requests" how-to).
 */

export const CAPTURE_CLI_NAMES = [
  "claude",
  "codex",
  "grok",
  "agy",
  "muse",
  "kimi",
  "cursor-agent",
] as const;
export type CaptureCliName = (typeof CAPTURE_CLI_NAMES)[number];

export type CaptureVerification = "verified" | "tls-only" | "unverified";

/**
 * How the CLI's runtime is told to trust the capture CA:
 * - `node-extra-ca`: `NODE_EXTRA_CA_CERTS=<ca.pem>` (additive; Node and Bun).
 * - `codex-ca`: `CODEX_CA_CERTIFICATE=<ca.pem>` (additive; Codex's rustls).
 * - `ssl-cert-file`: `SSL_CERT_FILE=<bundle.pem>`, the system roots plus the
 *   CA. Go and some rustls builds replace their roots with this file, and
 *   every child process inherits it, so it must never be the CA alone.
 */
export type CaptureTrust = "node-extra-ca" | "codex-ca" | "ssl-cert-file";

/** A request that is recorded; everything else on the host passes untouched. */
export type CaptureRoute = {
  readonly host: string;
  readonly methods: readonly string[];
  /** Anchored regular expression over the path (query included). */
  readonly path: string;
  /** True for a WebSocket upgrade whose messages are recorded. */
  readonly websocket: boolean;
  /** False until a real request on this route has been observed. */
  readonly verified: boolean;
};

export type CaptureCli = {
  readonly name: CaptureCliName;
  readonly label: string;
  readonly status: CaptureVerification;
  /** The `toolkit history` source its transcripts are indexed under. */
  readonly historySource: HistorySourceName | null;
  readonly trust: CaptureTrust;
  /** Extra variables the runtime needs to use the proxy at all. */
  readonly extraEnv: Readonly<Record<string, string>>;
  /**
   * Request headers whose value equals the transcript's runtime id, checked
   * in order. Empty when the correlation key is unknown.
   */
  readonly sessionHeaders: readonly string[];
  readonly routes: readonly CaptureRoute[];
};

const CODEX_RESPONSES = String.raw`^/backend-api/codex/responses(\?|$)`;

export const CAPTURE_CLIS: readonly CaptureCli[] = [
  {
    name: "claude",
    label: "Claude Code",
    status: "verified",
    historySource: "claude",
    trust: "node-extra-ca",
    extraEnv: {},
    sessionHeaders: ["x-claude-code-session-id"],
    routes: [
      {
        host: "api.anthropic.com",
        methods: ["POST"],
        path: String.raw`^/v1/messages(\?|$)`,
        websocket: false,
        verified: true,
      },
    ],
  },
  {
    name: "codex",
    label: "Codex",
    status: "verified",
    historySource: "codex",
    trust: "codex-ca",
    extraEnv: {},
    sessionHeaders: ["thread-id", "session-id"],
    routes: [
      {
        host: "chatgpt.com",
        methods: ["GET"],
        path: CODEX_RESPONSES,
        websocket: true,
        verified: true,
      },
      // The HTTP fallback when the WebSocket is unavailable: same path, SSE.
      {
        host: "chatgpt.com",
        methods: ["POST"],
        path: CODEX_RESPONSES,
        websocket: false,
        verified: false,
      },
    ],
  },
  {
    name: "grok",
    label: "Grok Build",
    status: "tls-only",
    historySource: "grok",
    trust: "ssl-cert-file",
    extraEnv: {},
    sessionHeaders: [],
    routes: [
      {
        host: "api.x.ai",
        methods: ["POST"],
        path: String.raw`^/v1/(chat/completions|responses|messages)(\?|$)`,
        websocket: false,
        verified: false,
      },
    ],
  },
  {
    name: "agy",
    label: "Antigravity CLI",
    status: "tls-only",
    historySource: "antigravity",
    trust: "ssl-cert-file",
    extraEnv: {},
    sessionHeaders: [],
    routes: [
      {
        host: "cloudcode-pa.googleapis.com",
        methods: ["POST"],
        path: String.raw`^/v1internal:(streamGenerateContent|generateContent|streamGenerateChat)(\?|$)`,
        websocket: false,
        verified: false,
      },
    ],
  },
  {
    name: "muse",
    label: "Muse",
    status: "tls-only",
    historySource: null,
    trust: "ssl-cert-file",
    extraEnv: {},
    sessionHeaders: [],
    routes: [
      {
        host: "api.meta.ai",
        methods: ["POST"],
        path: String.raw`^/v1/(chat/completions|responses|messages)(\?|$)`,
        websocket: false,
        verified: false,
      },
    ],
  },
  {
    name: "kimi",
    label: "Kimi Code",
    status: "unverified",
    historySource: null,
    trust: "node-extra-ca",
    extraEnv: { NODE_USE_ENV_PROXY: "1" },
    sessionHeaders: [],
    routes: ["api.kimi.com", "api.kimi.ai"].map((host) => ({
      host,
      methods: ["POST"],
      path: String.raw`^/coding/v1/(chat/completions|messages|responses)(\?|$)`,
      websocket: false,
      verified: false,
    })),
  },
  {
    name: "cursor-agent",
    label: "Cursor CLI",
    status: "unverified",
    historySource: "cursor",
    trust: "node-extra-ca",
    extraEnv: { NODE_USE_ENV_PROXY: "1" },
    sessionHeaders: [],
    routes: [
      {
        host: "api2.cursor.sh",
        methods: ["POST"],
        path: String.raw`^/aiserver\.v1\.(ChatService|AiService)/`,
        websocket: false,
        verified: false,
      },
    ],
  },
];

/**
 * Hosts that must never be intercepted: OAuth and token endpoints, plus
 * telemetry that shares a CLI's process. They are not in any route, and a
 * test keeps it that way.
 */
export const NEVER_INTERCEPT_HOSTS = [
  "auth.x.ai",
  "accounts.x.ai",
  "auth.meta.com",
  "auth.kimi.com",
  "accounts.google.com",
  "oauth2.googleapis.com",
  "auth.openai.com",
  "platform.claude.com",
  "console.anthropic.com",
  "http-intake.logs.us5.datadoghq.com",
  "ab.chatgpt.com",
  "play.googleapis.com",
  "mcp-proxy.anthropic.com",
] as const;

export function captureCli(name: string): CaptureCli | undefined {
  return CAPTURE_CLIS.find((cli) => cli.name === name);
}

/** Every host any CLI could intercept: the CA's name constraints. */
export function allCaptureHosts(): string[] {
  return [
    ...new Set(
      CAPTURE_CLIS.flatMap((cli) => cli.routes.map((route) => route.host)),
    ),
  ].toSorted();
}

/** The hosts intercepted for the enabled CLIs. */
export function interceptedHosts(clis: readonly CaptureCli[]): string[] {
  return [
    ...new Set(clis.flatMap((cli) => cli.routes.map((route) => route.host))),
  ].toSorted();
}

/**
 * mitmproxy's `allow_hosts` matches `host:port`, so an anchored `^host$`
 * silently matches nothing; each pattern accepts an optional `:443`.
 */
export function allowHostPattern(host: string): string {
  return `^${host.replaceAll(".", String.raw`\.`)}(:443)?$`;
}

/** The addon's route table: what it records, tagged with the CLI. */
export function addonRoutes(clis: readonly CaptureCli[]): {
  cli: string;
  host: string;
  methods: string[];
  path: string;
  websocket: boolean;
}[] {
  return clis.flatMap((cli) =>
    cli.routes.map((route) => ({
      cli: cli.name,
      host: route.host,
      methods: [...route.methods],
      path: route.path,
      websocket: route.websocket,
    })),
  );
}
