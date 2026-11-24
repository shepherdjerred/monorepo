import os from "node:os";
import path from "node:path";
import { z } from "zod";

export type PinchtabResult<T> = {
  success: boolean;
  data?: T | undefined;
  error?: string | undefined;
};

const DEFAULT_PINCHTAB_PORT = "9867";
export const PINCHTAB_HTTP_TIMEOUT_MS = 30_000;

export type PinchtabClientOptions = {
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly homeDir?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
};

export type PinchtabConnection = {
  readonly baseUrl: string;
  readonly token: string | undefined;
  readonly configError?: string | undefined;
};

export type HttpRequestSpec = {
  readonly method: "GET" | "POST" | "DELETE";
  readonly routePath: string;
  readonly body?: unknown;
  readonly sessionToken?: string | undefined;
};

const PinchtabConfigFileSchema = z.looseObject({
  server: z
    .looseObject({
      port: z.union([z.string(), z.number()]).optional(),
      token: z.string().optional(),
    })
    .optional(),
});
const ErrorPayloadSchema = z.looseObject({
  error: z.string().optional(),
  message: z.string().optional(),
});

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

export function tabRoute(tabId: string, suffix: string): string {
  return `/tabs/${encodeURIComponent(tabId)}${suffix}`;
}

function candidateConfigPaths(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): readonly { readonly path: string; readonly explicit: boolean }[] {
  const explicit = nonEmpty(env["PINCHTAB_CONFIG"]);
  return explicit === undefined
    ? [
        {
          path: path.join(
            homeDir,
            "Library/Application Support/pinchtab/config.json",
          ),
          explicit: false,
        },
        { path: path.join(homeDir, ".pinchtab/config.json"), explicit: false },
      ]
    : [{ path: explicit, explicit: true }];
}

export async function resolvePinchtabConnection(
  options: PinchtabClientOptions = {},
): Promise<PinchtabConnection> {
  const env = options.env ?? Bun.env;
  const homeDir = options.homeDir ?? nonEmpty(env["HOME"]) ?? os.homedir();
  let filePort: string | undefined;
  let fileToken: string | undefined;
  let configError: string | undefined;

  for (const candidate of candidateConfigPaths(env, homeDir)) {
    const file = Bun.file(candidate.path);
    if (!(await file.exists())) {
      if (candidate.explicit) {
        configError = `PINCHTAB_CONFIG file not found: ${candidate.path}`;
      }
      continue;
    }
    try {
      const parsed = PinchtabConfigFileSchema.parse(
        JSON.parse(await file.text()),
      );
      const rawPort = parsed.server?.port;
      filePort = rawPort === undefined ? undefined : nonEmpty(String(rawPort));
      fileToken = nonEmpty(parsed.server?.token);
      break;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      configError = `Invalid PinchTab config at ${candidate.path}: ${msg}`;
      break;
    }
  }

  const serverOverride = nonEmpty(env["PINCHTAB_SERVER"]);
  const baseUrl =
    serverOverride === undefined
      ? `http://127.0.0.1:${filePort ?? DEFAULT_PINCHTAB_PORT}`
      : serverOverride.replace(/\/+$/u, "");
  // Never read PINCHTAB_SESSION here so admin calls cannot inherit a foreign agent session.
  const token = nonEmpty(env["PINCHTAB_TOKEN"]) ?? fileToken;
  return {
    baseUrl,
    token,
    ...(configError === undefined ? {} : { configError }),
  };
}

export function formatHttpFailure(
  method: string,
  routePath: string,
  status: number,
  rawBody: string,
): PinchtabResult<never> {
  let detail = rawBody.trim();
  if (detail.length > 0) {
    try {
      const parsed = ErrorPayloadSchema.safeParse(JSON.parse(detail));
      if (parsed.success) {
        detail = parsed.data.error ?? parsed.data.message ?? detail;
      }
    } catch {
      // Keep plain-text detail.
    }
  }
  const suffix = detail.length > 0 ? `: ${detail}` : "";
  return {
    success: false,
    error: `pinchtab ${method} ${routePath} failed (${String(status)})${suffix}`,
  };
}

export async function sendRequest(
  connection: PinchtabConnection,
  authToken: string | undefined,
  request: HttpRequestSpec,
  options: PinchtabClientOptions = {},
): Promise<PinchtabResult<Response>> {
  if (authToken === undefined || authToken.length === 0) {
    const error =
      connection.configError ??
      "PinchTab bearer token not found in PINCHTAB_TOKEN or config.json";
    return { success: false, error };
  }
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PINCHTAB_HTTP_TIMEOUT_MS;
  const headers: Record<string, string> = {
    authorization: `Bearer ${authToken}`,
    ...(request.body === undefined
      ? {}
      : { "content-type": "application/json" }),
  };
  try {
    const response = await fetchFn(
      `${connection.baseUrl}${request.routePath}`,
      {
        method: request.method,
        headers,
        ...(request.body === undefined
          ? {}
          : { body: JSON.stringify(request.body) }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    return { success: true, data: response };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestText(
  request: HttpRequestSpec,
  options: PinchtabClientOptions,
): Promise<PinchtabResult<string>> {
  const connection = await resolvePinchtabConnection(options);
  const sent = await sendRequest(
    connection,
    request.sessionToken ?? connection.token,
    request,
    options,
  );
  if (!sent.success || sent.data === undefined) {
    return { success: false, error: sent.error };
  }
  const text = await sent.data.text();
  return sent.data.ok
    ? { success: true, data: text.trim() }
    : formatHttpFailure(
        request.method,
        request.routePath,
        sent.data.status,
        text,
      );
}

export async function requestJson<T>(
  request: HttpRequestSpec,
  schema: z.ZodType<T>,
  options: PinchtabClientOptions,
): Promise<PinchtabResult<T>> {
  const raw = await requestText(request, options);
  if (!raw.success || raw.data === undefined) {
    return { success: false, error: raw.error };
  }
  try {
    const parsed = schema.safeParse(JSON.parse(raw.data));
    return parsed.success
      ? { success: true, data: parsed.data }
      : {
          success: false,
          error: `pinchtab output failed schema validation: ${parsed.error.message}`,
        };
  } catch (error: unknown) {
    return {
      success: false,
      error: `pinchtab returned non-JSON output: ${String(error)}`,
    };
  }
}
